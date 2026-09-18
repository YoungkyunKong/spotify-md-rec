# Album Deck

앨범을 검색하고 Spotify 플레이리스트를 선택해 브라우저 안에서 재생하는 개인용 웹 앱입니다. Spotify Web Playback SDK를 사용하며 Python API 백엔드는 없습니다. Node.js는 `web/` 정적 파일과 공개 런타임 설정을 제공하고, 로그인·검색·재생 API 요청은 브라우저가 Spotify에 직접 보냅니다.

## 요구 사항

- Node.js 20 이상
- Spotify Premium 계정
- 앱 계정이 Spotify Developer Dashboard의 사용자 목록에 등록되어 있어야 합니다.
- 로컬 실행 시 Spotify 앱 설정에 Redirect URI `http://127.0.0.1:8888/callback`을 등록합니다.
- Web Playback SDK를 앱에서 사용할 수 있도록 설정합니다.

기본 Client ID는 `4f876bef5a0b46f2931b4b5e1cae8af1`입니다. 다른 앱을 쓰려면 `SPOTIFY_CLIENT_ID` 환경 변수를 지정합니다. Client Secret은 사용하지 않습니다.

## 실행

프로젝트 폴더에서:

```powershell
npm start
```

브라우저에서 [http://127.0.0.1:8888](http://127.0.0.1:8888)을 엽니다. Spotify 연결을 누르면 PKCE 로그인 후 앱으로 돌아옵니다. 로그인 화면은 매번 승인 대화상자를 표시하므로 현재 계정이 다르면 Spotify 화면의 **Not you?** 링크로 다른 계정을 선택할 수 있습니다. 연결된 뒤에는 우측 상단 **Spotify 연결됨**에서 **다른 계정으로 연결** 또는 **연결 해제**를 선택합니다. `Ctrl+C`로 정적 파일 서버를 종료합니다.

Windows에 사용자 앱으로 설치하려면 `install-windows.cmd`를 더블 클릭하거나 PowerShell에서 `install-windows.ps1`을 실행합니다. 설치 프로그램은 Node.js 20 이상을 확인하고 `%LOCALAPPDATA%\Programs\AlbumDeck`에 앱을 복사한 뒤, MiniDisc 아이콘이 적용된 **Album Deck** 바로가기를 바탕 화면과 시작 메뉴에 자동 등록합니다. 바로가기는 Edge의 독립 앱 창으로 열리며, Edge가 없으면 Chrome을 사용합니다. 주소창이나 브라우저 탭은 표시되지 않고 기존 브라우저 프로필의 로그인 정보와 설정은 유지됩니다. 시작 메뉴의 **Album Deck Stop**으로 백그라운드 서버를 종료할 수 있습니다.

## Node.js 앱 배포

앱은 별도 빌드 과정이나 Docker 없이 일반 Node.js 웹 서비스로 배포할 수 있습니다. 호스팅 서비스의 런타임은 Node.js 20 이상, 시작 명령은 `npm start`, 상태 확인 주소는 `/healthz`로 지정합니다. 서비스가 주입하는 `PORT`를 자동 사용하며 외부 접속을 위해 `0.0.0.0`에 바인딩합니다.

Render에서는 저장소를 연결한 뒤 루트의 `render.yaml` Blueprint를 사용하면 Node 런타임, 시작 명령과 상태 확인 경로가 자동 설정됩니다. 대시보드에서 직접 Web Service를 만들 경우 다음 값을 사용합니다.

```text
Runtime: Node
Build Command: npm install --omit=dev
Start Command: npm start
Health Check Path: /healthz
```

다른 Node 호스팅에서는 `Procfile`의 `web: npm start`를 사용할 수 있습니다. Client ID를 바꾸는 경우에만 다음 환경 변수를 지정합니다.

```text
SPOTIFY_CLIENT_ID=4f876bef5a0b46f2931b4b5e1cae8af1
```

`PUBLIC_URL=https://실제-배포-도메인`을 선택적으로 지정하면 OAuth 콜백 주소를 해당 도메인으로 고정합니다. 지정하지 않으면 브라우저에 열린 현재 HTTPS 주소를 자동 사용합니다.

배포가 끝나면 Spotify Developer Dashboard에서 이 앱의 Redirect URI에 다음 주소를 정확히 추가하고 저장합니다.

```text
https://실제-배포-도메인/callback
```

공개 배포 주소에는 HTTPS가 필요합니다. Spotify의 Redirect URI는 대소문자, 포트, 경로와 끝 슬래시까지 등록값과 정확히 일치해야 합니다. 로컬 개발용 `http://127.0.0.1:8888/callback`은 함께 남겨둘 수 있습니다.

첫 로그인은 `streaming`, `user-read-private`, `user-read-email`, `user-read-playback-state`, `user-modify-playback-state`, `playlist-read-private`, `playlist-read-collaborative` 권한을 요청합니다. 기존 CLI 토큰은 이 브라우저 앱에 쓰이지 않습니다. access/refresh token은 이 PC의 브라우저 로컬 저장소에 보관되어 앱을 다시 실행해도 로그인이 유지되며, **연결 해제** 또는 **다른 계정으로 연결**을 선택하면 지워집니다.

## 사용

- **앨범 찾기**에서 앨범명이나 아티스트를 검색하고 앨범 카드를 눌러 전체 앨범을 재생합니다.
- **내 플레이리스트**에서 재생할 목록을 선택합니다. 원본 목록을 수정하지 않습니다.
- 설정에서 이 브라우저 또는 계정에 연결된 다른 Spotify Connect 장치를 재생 대상으로 선택합니다.
- 이 브라우저로 재생할 때 **Windows 출력 설정 열기**를 눌러 브라우저 소리를 오디오 인터페이스로 보낼 수 있습니다.
- 상단의 **재생 설정**에서 0~30초 사이의 곡간 무음을 0.5초 단위로 지정합니다. 설정은 이 브라우저에 저장됩니다.
- 아래 플레이어에서 재생·일시정지, 이전/다음 곡, 탐색과 볼륨을 조절합니다.
- 오른쪽 재생 정보와 Spotify 링크에서 현재 트랙과 앨범을 확인할 수 있습니다.

재생 설정에서 Album Deck 브라우저 플레이어 또는 다른 Spotify Connect 장치를 선택할 수 있습니다. 곡별 대기열과 무음 전환은 이 웹 앱이 제어하므로 탭을 닫거나 장치가 절전 상태가 되면 다음 곡 전환이 중단될 수 있습니다. SDK 초기화 오류가 나면 최신 Chrome/Edge에서 보호된 콘텐츠 재생(EME)을 허용하고 다시 연결하세요.

Spotify Web Playback SDK는 Premium 계정이 필요합니다. SDK가 브라우저 안에 별도 Spotify Connect 재생 기기를 만들고, 앱은 앨범·플레이리스트의 곡 목록을 읽어 그 기기에서 한 곡씩 순서대로 재생합니다. [공식 SDK 안내](https://developer.spotify.com/documentation/web-playback-sdk), [재생 API](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback).

## 검증

```powershell
npm run check
npm start
```

Spotify 콘텐츠·앨범 표지·메타데이터는 Spotify에서 제공합니다. 본 앱은 계정 인증과 브라우저 재생만 수행하며 Spotify 음원을 다운로드하거나 파일로 저장하지 않습니다. [Spotify 이용자 지침](https://www.spotify.com/us/legal/user-guidelines/).
