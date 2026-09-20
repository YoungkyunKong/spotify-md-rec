# Album Deck

Spotify 앨범과 플레이리스트를 브라우저에서 재생하고, 곡 사이에 지정한 무음 시간을 넣어 MiniDisc 녹음을 돕는 개인용 앱입니다.

## 설치 방법

1. 이 ZIP을 원하는 폴더에 압축 해제합니다.
2. `install-windows.cmd`를 마우스 오른쪽 버튼으로 선택하고 **관리자 권한으로 실행**합니다.
3. Node.js 20 이상이 없으면 설치 스크립트가 Windows `winget`으로 Node.js LTS를 자동 설치합니다.
4. 바탕 화면에 만들어진 **Album Deck** 바로가기를 실행합니다.
5. 앱의 **설정**에서 Spotify Client ID와 Redirect URI를 입력합니다.
6. Spotify Developer Dashboard에 `http://127.0.0.1:8888/callback`을 Redirect URI로 등록한 뒤 **Spotify 연결**을 누릅니다.

Spotify Premium 계정이 필요합니다. `winget`을 사용할 수 없는 Windows에서는 Windows App Installer를 먼저 설치하세요. 앱을 종료하려면 시작 메뉴의 **Album Deck Stop**을 실행합니다.
