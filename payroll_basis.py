"""수업별 정산 기준 보존. 현재 반 설정을 과거 수업에 소급하지 않는다."""

COLUMNS = {
    'PayCategoryId': 'INTEGER',
    'PayCategoryName': "TEXT DEFAULT ''",
    'PayGradeGroup': "TEXT DEFAULT ''",
    'PayUnitAmount': 'INTEGER',
    'PayEffectiveFrom': "TEXT DEFAULT ''",
    'PayBasisSource': "TEXT DEFAULT ''",
    'PayCapturedAt': "TEXT DEFAULT ''",
}


def install_payroll_basis(conn):
    """동일 트랜잭션에서 신규/정정 기록을 보존하고 기존 기록은 도입 기준임을 표시한다."""
    cols = {r[1] for r in conn.execute('PRAGMA table_info("StudyLogs")')}
    if not cols:
        return
    for name, ddl in COLUMNS.items():
        if name not in cols:
            conn.execute('ALTER TABLE "StudyLogs" ADD COLUMN "{}" {}'.format(name, ddl))

    whitespace = ' || '.join('CHAR({})'.format(c) for c in list(range(9, 14)) + list(range(28, 33)) + [133, 160, 5760] + list(range(8192, 8203)) + [8232, 8233, 8239, 8287, 12288])
    def stripped(value):
        return "TRIM(COALESCE({}, ''), {})".format(value, whitespace)
    grade = "COALESCE(NULLIF({}, ''), {}, '')".format(stripped('GradeSnapshot'), stripped('(SELECT Grade FROM Students WHERE Students.rowid=StudyLogs.StudentId OR Students.Id=StudyLogs.StudentId LIMIT 1)'))
    group = "CASE WHEN {g} LIKE '초%' OR {g} IN ('1','2','3','4','5','6') THEN '초등' WHEN {g} LIKE '중%' OR {g} IN ('7','8','9') THEN '중등' ELSE '기타' END".format(g=grade)
    category = '(SELECT CategoryId FROM Classes WHERE Id=StudyLogs.ClassId)'
    category = 'COALESCE({}, PayrollCategoryId)'.format(category)
    names = '(SELECT Name FROM ClassCategories WHERE Id=StudyLogs.PayCategoryId)'
    normal = 'FROM TeacherPayRates WHERE CategoryId=StudyLogs.PayCategoryId AND GradeGroup=StudyLogs.PayGradeGroup AND EffectiveFrom<=StudyLogs.StudiedDay ORDER BY EffectiveFrom DESC LIMIT 1'
    special = 'FROM SpecialLessonPayRates WHERE EffectiveFrom<=StudyLogs.StudiedDay ORDER BY EffectiveFrom DESC LIMIT 1'
    rate = 'CASE WHEN IsSpecial=1 THEN (SELECT UnitAmount {}) ELSE (SELECT UnitAmount {}) END'.format(special, normal)
    effective = 'CASE WHEN IsSpecial=1 THEN (SELECT EffectiveFrom {}) ELSE (SELECT EffectiveFrom {}) END'.format(special, normal)
    def capture(where, source, preserve_category=False):
        cat = 'PayCategoryId' if preserve_category else category
        name = 'PayCategoryName' if preserve_category else "COALESCE({}, '')".format(names)
        return '''UPDATE StudyLogs SET PayCategoryId={cat}, PayGradeGroup={group},
            PayUnitAmount=NULL, PayEffectiveFrom='', PayBasisSource='{source}',
            PayCapturedAt=datetime('now','localtime') WHERE {where};
            UPDATE StudyLogs SET PayCategoryName={name}, PayUnitAmount={rate},
            PayEffectiveFrom=COALESCE({effective}, '') WHERE {where};'''.format(
                cat=cat, group=group, source=source, where=where, name=name, rate=rate, effective=effective)

    # 마감 금액은 TeacherPayrollLines를 계속 사용한다. 원본의 이 값은 마감 재계산에 쓰지 않는다.
    legacy = [r[0] for r in conn.execute("SELECT rowid FROM StudyLogs WHERE COALESCE(PayBasisSource, '')=''")]
    for rowid in legacy:
        for statement in capture('rowid={}'.format(int(rowid)), 'legacy').split(';'):
            if statement.strip():
                conn.execute(statement)

    for name in ('insert', 'reclass', 'correct', 'normal_rate_insert', 'normal_rate_update', 'special_rate_insert', 'special_rate_update', 'first_category'):
        conn.execute('DROP TRIGGER IF EXISTS _app_pay_basis_' + name)
    # 복수 도서를 나중에 추가해도 같은 차시의 먼저 보존한 기준을 이어받는다.
    peer = '''SELECT p.rowid FROM StudyLogs p WHERE p.rowid<>NEW.rowid
        AND p.StudentId IS NEW.StudentId AND p.StudiedDay IS NEW.StudiedDay
        AND p.ClassId IS NEW.ClassId AND (NEW.ClassId IS NOT NULL OR p.PayrollCategoryId IS NEW.PayrollCategoryId)
        AND {peer_teacher}={new_teacher}
        AND COALESCE(p.IsSpecial,0)=COALESCE(NEW.IsSpecial,0)
        AND {peer_content}={new_content}
        AND COALESCE(p.PayBasisSource,'')<>'' ORDER BY p.rowid LIMIT 1'''.format(
            peer_teacher="COALESCE(NULLIF({}, ''), {}, '')".format(stripped('p.ActualTeacherUsername'), stripped('(SELECT TeacherUsername FROM Classes WHERE Id=p.ClassId)')),
            new_teacher="COALESCE(NULLIF({}, ''), {}, '')".format(stripped('NEW.ActualTeacherUsername'), stripped('(SELECT TeacherUsername FROM Classes WHERE Id=NEW.ClassId)')),
            peer_content=stripped('p.LessonContent'), new_content=stripped('NEW.LessonContent'))
    copy = ', '.join('{c}=(SELECT {c} FROM StudyLogs WHERE rowid=({p}))'.format(c=c, p=peer) for c in COLUMNS)
    copy_peer = 'UPDATE StudyLogs SET {copy} WHERE rowid=NEW.rowid AND EXISTS ({peer});'.format(copy=copy, peer=peer)
    conn.execute('''CREATE TRIGGER _app_pay_basis_insert AFTER INSERT ON StudyLogs BEGIN
        {capture} {copy_peer} END'''.format(capture=capture('rowid=NEW.rowid', 'recorded'), copy_peer=copy_peer))
    conn.execute('''CREATE TRIGGER _app_pay_basis_reclass AFTER UPDATE OF ClassId, PayrollCategoryId ON StudyLogs
        WHEN OLD.ClassId IS NOT NEW.ClassId OR OLD.PayrollCategoryId IS NOT NEW.PayrollCategoryId
        BEGIN {capture} {copy_peer} END'''.format(capture=capture('rowid=NEW.rowid', 'corrected'), copy_peer=copy_peer))
    conn.execute('''CREATE TRIGGER _app_pay_basis_correct AFTER UPDATE OF StudiedDay, IsSpecial, GradeSnapshot ON StudyLogs
        WHEN OLD.ClassId IS NEW.ClassId AND OLD.PayrollCategoryId IS NEW.PayrollCategoryId AND
        (OLD.StudiedDay IS NOT NEW.StudiedDay OR OLD.IsSpecial IS NOT NEW.IsSpecial OR OLD.GradeSnapshot IS NOT NEW.GradeSnapshot)
        BEGIN {capture} {copy_peer} END'''.format(capture=capture('rowid=NEW.rowid', 'corrected', True), copy_peer=copy_peer))
    # 처음 수업 종류를 지정할 때만 미확정 기록을 보완한다. 이미 보존된 종류는 건드리지 않는다.
    conn.execute('''CREATE TRIGGER _app_pay_basis_first_category AFTER UPDATE OF CategoryId ON Classes
        WHEN OLD.CategoryId IS NULL AND NEW.CategoryId IS NOT NULL
        BEGIN
            UPDATE StudyLogs SET PayCategoryId=NEW.CategoryId, PayBasisSource='resolving'
            WHERE ClassId=NEW.Id AND PayCategoryId IS NULL AND PayUnitAmount IS NULL
            AND COALESCE(IsSpecial,0)=0
            AND NOT EXISTS (SELECT 1 FROM TeacherPayrollLines WHERE StudyLogId=StudyLogs.rowid)
            AND NOT EXISTS (SELECT 1 FROM TeacherPayrollClosures WHERE PayrollMonth=substr(StudyLogs.StudiedDay,1,7)
                AND TeacherUsername=COALESCE(NULLIF(TRIM(StudyLogs.ActualTeacherUsername),''),NEW.TeacherUsername));
            UPDATE StudyLogs SET PayCategoryName=COALESCE({names}, ''), PayUnitAmount={rate},
                PayEffectiveFrom=COALESCE({effective}, ''), PayBasisSource='completed', PayCapturedAt=datetime('now','localtime')
            WHERE ClassId=NEW.Id AND PayBasisSource='resolving';
        END'''.format(names=names, rate=rate, effective=effective))
    # 미설정은 0원과 구별하고 처음 이용 가능한 단가만 저장한다.
    for table, prefix, condition in [('TeacherPayRates', 'normal', 'COALESCE(IsSpecial,0)=0 AND PayCategoryId=NEW.CategoryId AND PayGradeGroup=NEW.GradeGroup'),
                                      ('SpecialLessonPayRates', 'special', 'IsSpecial=1')]:
        for action in ('INSERT', 'UPDATE'):
            conn.execute('''CREATE TRIGGER _app_pay_basis_{prefix}_rate_{action_lower} AFTER {action} ON {table}
                BEGIN UPDATE StudyLogs SET PayUnitAmount={rate}, PayEffectiveFrom=COALESCE({effective}, ''),
                PayCapturedAt=datetime('now','localtime')
                WHERE PayUnitAmount IS NULL AND {condition} AND StudiedDay>=NEW.EffectiveFrom
                AND NOT EXISTS (SELECT 1 FROM TeacherPayrollLines WHERE StudyLogId=StudyLogs.rowid);
                END'''.format(prefix=prefix, action_lower=action.lower(), action=action, table=table,
                              rate=rate, effective=effective, condition=condition))


def load_payroll_basis(conn, month):
    """구버전 테스트/읽기 전용 DB도 조회 가능하며 실제 앱은 시작 시 스키마를 보완한다."""
    if 'PayBasisSource' not in {r[1] for r in conn.execute('PRAGMA table_info("StudyLogs")')}:
        return {}
    return {r['record_rowid']: dict(r) for r in conn.execute(
        'SELECT rowid AS record_rowid, {} FROM StudyLogs WHERE substr(StudiedDay,1,7)=?'.format(','.join(COLUMNS)), (month,))}
