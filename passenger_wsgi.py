import sys
import os

# 현재 디렉터리를 sys.path 최상단에 추가하여 모듈 임포트 가능하도록 설정
sys.path.insert(0, os.path.dirname(__file__))

# 가비아 파이썬 3.9 호스팅 (Phusion Passenger WSGI) 전용 진입점 설정
try:
    from a2wsgi import ASGIMiddleware
    from main import app
    application = ASGIMiddleware(app)
except Exception as e:
    import logging
    logging.exception("passenger_wsgi.py 로딩 중 오류 발생: %s", e)
    raise
