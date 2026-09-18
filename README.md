# Album Deck Desktop

Spotify 앨범이나 내 플레이리스트를 별도 데스크톱 창에서 재생하고, 곡 사이에 사용자가 지정한 무음 구간을 넣는 개인용 Windows 앱입니다. Spotify Web Playback SDK와 Widevine을 지원하는 Castlabs Electron 런타임을 사용합니다.

## 요구 사항

- Windows 10/11
- Spotify Premium 계정
- 인터넷 연결(최초 실행 시 Widevine 구성 요소 다운로드 포함)
- 개발 시 Node.js 22.12 이상

기본 Spotify Client ID는 `4f876bef5a0b46f2931b4b5e1cae8af1`입니다. Spotify Developer Dashboard에 Redirect URI `http://127.0.0.1:8888/callback`을 정확히 등록해야 합니다. 다른 앱을 사용하려면 실행 전에 `SPOTIFY_CLIENT_ID` 환경 변수를 지정합니다. Client Secret은 사용하지 않습니다.

## 개발 실행

```powershell
npm install
npm start
```

처음 실행하면 재생에 필요한 Widevine 구성 요소를 내려받은 뒤 앱 창이 열립니다. 이전 웹 버전의 로컬 서버가 포트 8888에서 실행 중이면 시작 메뉴의 **Album Deck Stop**으로 먼저 종료합니다.

웹 버전을 브라우저에서만 실행하려면 다음 명령을 사용합니다.

```powershell
npm run start:web
```

## Windows 설치 파일 만들기

```powershell
npm run check
npm run dist
```

완성된 설치 파일은 `dist/Album-Deck-Setup-1.0.0.exe`에 생성됩니다. 설치 프로그램은 바탕 화면과 시작 메뉴에 **Album Deck** 바로가기를 만듭니다.

## 사용

- **앨범 찾기**에서 앨범명이나 아티스트를 검색한 뒤 앨범을 재생합니다.
- **내 플레이리스트**에서 Spotify 계정의 목록을 선택합니다. 원본 플레이리스트는 수정하지 않습니다.
- 상단 **재생 설정**에서 곡 사이 무음을 0~30초, 0.5초 단위로 조정합니다.
- 재생 대상을 Album Deck의 내장 플레이어나 다른 Spotify Connect 장치로 선택할 수 있습니다.
- 내장 플레이어를 선택하면 **Windows 출력 설정 열기**에서 사용할 오디오 인터페이스를 지정할 수 있습니다.
- 재생 중 앱이나 대상 장치를 닫으면 다음 곡 전환이 중단될 수 있습니다.

인증 토큰은 앱 세션 저장소에만 보관됩니다. 계정을 바꾸려면 상단 **Spotify 연결**에서 **다른 계정으로 연결** 또는 **연결 해제**를 선택합니다.

## 동작 방식

Album Deck은 재생 목록을 한 곡씩 내장 Spotify 재생기로 전달합니다. 곡이 끝나면 지정한 시간 동안 일시 정지한 후 다음 곡을 시작하므로 MiniDisc에서 트랙을 나누기 쉬운 무음 구간이 생깁니다. Spotify 콘텐츠를 파일로 저장하거나 내려받지는 않습니다.

첫 로그인에서는 `streaming`, `user-read-private`, `user-read-email`, `user-read-playback-state`, `user-modify-playback-state`, `playlist-read-private`, `playlist-read-collaborative` 권한을 요청합니다.

## 검사

```powershell
npm run check
```

Spotify Web Playback SDK는 Premium 계정이 필요합니다. 자세한 동작과 제한은 [Spotify Web Playback SDK 문서](https://developer.spotify.com/documentation/web-playback-sdk)를 참고하세요.
