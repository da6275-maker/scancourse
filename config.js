// config.js — 회사 공통 설정. 여기만 고치면 됩니다.
window.APP_CONFIG = {
  // 카카오 개발자 사이트(developers.kakao.com) > 내 애플리케이션 > 앱 키 > "JavaScript 키"
  KAKAO_JS_KEY: 'c4abb42764c977b9946eee578bf529e1',

  // 주소에 시/군이 빠져 있을 때 앞에 붙일 지역 (각자 설정에서 바꿀 수 있음)
  DEFAULT_REGION: '경기 포천시',

  // 기본 출발지 주소 (예: 회사 주소). 비워 두면 각자 설정에서 입력
  DEFAULT_HOME: '',

  // '내비 시작' 버튼이 여는 기본 앱: naver | kakaonavi | kakaomap | tmap (각자 설정에서 바꿀 수 있음)
  DEFAULT_NAV: 'naver',

  // 도로 기준으로 순서 계산 (공개 경로 서버 사용, 실패하면 직선거리로 계산)
  ROAD_ORDER: true,

  // 익명 건의함: 구글 설문(폼)으로 보냅니다. 응답은 설문 주인만 봅니다. 비워 두면 건의함이 안 보입니다.
  BOARD_FORM_URL: '',      // 예: https://docs.google.com/forms/d/e/1FAIpQL.../viewform
  BOARD_ENTRY_ID: '',      // 설문 질문 번호(entry.뒤 숫자). 비우면 설문 화면을 그대로 끼워 넣음
  BOARD_TITLE: '익명 건의함',
  BOARD_NOTE: '누가 보냈는지 남지 않습니다. 관리자 한 사람만 읽습니다.',

  APP_NAME: '스캔코스',
  VERSION: '1.0.4'
};
