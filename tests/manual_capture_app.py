"""매뉴얼 캡처용 앱. 실제 DB를 읽지 않고 별도 폴더에 예시 자료만 만든다.

MANUAL_DEMO_DIR를 지정하고 uvicorn tests.manual_capture_app:app 대신
--app-dir tests manual_capture_app:app으로 실행한다. 외부 공개 금지.
"""
import os
import secrets
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
if not os.environ.get('MANUAL_DEMO_DIR'):
    raise RuntimeError('캡처 전용 폴더를 MANUAL_DEMO_DIR에 지정하세요.')
DEMO_DIR = Path(os.environ['MANUAL_DEMO_DIR']).resolve()
DEMO_DIR.mkdir(parents=True, exist_ok=True)
DEMO_DB = DEMO_DIR / 'manual-demo.db'
if DEMO_DB == ROOT / 'data.db':
    raise RuntimeError('실제 DB를 캡처용으로 사용할 수 없습니다.')
os.environ['SQLITE_DB_PATH'] = str(DEMO_DB)
os.environ['SECRET_KEY'] = secrets.token_hex(32)
os.environ['ADMIN_USERNAME'] = 'manual_admin'
os.environ['ADMIN_PASSWORD'] = secrets.token_urlsafe(24)

import main
import database
from config import settings

# 최초 기동에만 예시 자료를 넣는다. 실제 데이터 복사 경로는 제공하지 않는다.
if not DEMO_DB.exists():
    with sqlite3.connect(str(DEMO_DB)) as conn:
        conn.executescript('''
            CREATE TABLE Books (
                Id INTEGER PRIMARY KEY, Title TEXT, Author TEXT, Publisher TEXT,
                Subject TEXT, Target TEXT, BookLength INTEGER DEFAULT 0,
                Voca INTEGER DEFAULT 0, Metaphor INTEGER DEFAULT 0,
                HasQuiz INTEGER DEFAULT 0, HasReadingQuestion INTEGER DEFAULT 0,
                HasReadingAnswer INTEGER DEFAULT 0, HasWritingQuestion INTEGER DEFAULT 0,
                HasWritingAnswer INTEGER DEFAULT 0, HasAdvancedMaterial INTEGER DEFAULT 0,
                HasDebateMaterial INTEGER DEFAULT 0, IsPaperbookExist INTEGER DEFAULT 0,
                IsPdfExist INTEGER DEFAULT 0, IsYes24Exist INTEGER DEFAULT 0,
                IsMillieExist INTEGER DEFAULT 0, "Desc" TEXT DEFAULT ''
            );
            CREATE TABLE Students (
                Id INTEGER PRIMARY KEY, Name TEXT, Sex TEXT, Birthday TEXT,
                Grade TEXT, School TEXT, Referrer TEXT DEFAULT '',
                IsClassEnded INTEGER DEFAULT 0, Description TEXT DEFAULT ''
            );
            CREATE TABLE StudyLogs (
                Id INTEGER PRIMARY KEY, StudentId INTEGER, BookId INTEGER, StudiedDay TEXT
            );
        ''')
    main.on_startup()
    password = secrets.token_urlsafe(18)
    (DEMO_DIR / 'demo-password.txt').write_text(password, encoding='utf-8')
    database.create_user('manual_teacher', password, 'teacher', '예시 선생님')
    with database.get_db_connection() as conn:
        conn.executescript('''
            INSERT INTO Books(Id,Title,Author,Publisher,Subject,Target,BookLength,Voca,HasReadingQuestion,IsPaperbookExist) VALUES
                (1,'숲속 친구들의 약속','예시 작가','예시 출판사','우정과 약속','초등부',2,2,1,1),
                (2,'우리 동네 작은 도서관','예시 작가','예시 출판사','이웃과 나눔','초등부',3,2,1,1),
                (3,'달빛 아래 토론회','예시 작가','예시 출판사','대화와 경청','초등부',3,3,1,1),
                (4,'씨앗을 심는 하루','예시 작가','예시 출판사','자연과 성장','초등부',2,1,0,1);
            INSERT INTO Students(Id,Name,Sex,Birthday,Grade,School,Description) VALUES
                (1,'예시학생 가','여','2016-01-01','초4','예시초등학교','자기 의견을 말하기 전에 생각할 시간을 충분히 주세요.'),
                (2,'예시학생 나','남','2016-01-01','초4','예시초등학교','발표할 때 근거를 덧붙이도록 안내합니다.'),
                (3,'예시학생 다','여','2016-01-01','초4','예시초등학교','친구의 발표 내용을 메모하며 듣는 연습을 합니다.');
            INSERT INTO ClassCategories(Id,Name) VALUES(1,'독서 토론');
            INSERT INTO Classes(Id,ClassName,TeacherUsername,DayOfWeek,StartTime,CategoryId)
                VALUES(1,'예시 독서반','manual_teacher','월','16:00',1);
            INSERT INTO ClassStudents(ClassId,StudentId,IsSpecial) VALUES(1,1,0),(1,2,0),(1,3,0);
            INSERT INTO TeacherPayRates(CategoryId,GradeGroup,UnitAmount,EffectiveFrom)
                VALUES(1,'초등',10000,'2026-01-01');
            INSERT INTO SpecialLessonPayRates(UnitAmount,EffectiveFrom) VALUES(5000,'2026-01-01');
            INSERT INTO StudyLogs(Id,StudentId,BookId,StudiedDay,ClassId,ActualTeacherUsername,IsSpecial,LessonContent,Description)
                VALUES(1,1,1,'2026-10-01',1,'manual_teacher',0,'등장인물의 마음을 비교하고 근거를 찾아 발표함.',''),
                      (2,2,1,'2026-10-01',1,'manual_teacher',0,'등장인물의 마음을 비교하고 근거를 찾아 발표함.',''),
                      (3,3,1,'2026-10-01',1,'manual_teacher',0,'등장인물의 마음을 비교하고 근거를 찾아 발표함.',''),
                      (4,1,2,'2026-10-03',1,'manual_teacher',0,'','다음 시간에 발표 이어서 진행');
            INSERT INTO TuitionPayments(StudentId,ClassType,PaidLessons,ServiceLessons,StartDate,PaidDate,FeeAmount)
                VALUES(1,'일반',10,0,'2026-10-01','2026-10-01',100000);
        ''')
        conn.execute('UPDATE Students SET GradeAtRegistration=Grade, RegistrationYear=?, RegistrationMonth=?',
                     (datetime.now().year, datetime.now().month))
        conn.commit()

app = main.app
