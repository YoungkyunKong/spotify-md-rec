# Album Deck

앨범을 검색하고 Spotify 플레이리스트를 선택해 브라우저 안에서 재생하는 개인용 웹 앱입니다. Spotify Web Playback SDK를 사용하며 Python API 백엔드는 없습니다. Node.js는 `web/` 정적 파일과 공개 런타임 설정을 제공하고, 로그인·검색·재생 API 요청은 브라우저가 Spotify에 직접 보냅니다.

## 요구 사항

- Node.js 20 이상
- Spotify Premium 계정
- Spotify 앱이 개발 모드라면 재생할 계정을 Spotify Developer Dashboard의 사용자 목록에 등록합니다.
- 로컬 실행 시 Spotify 앱 설정에 Redirect URI `http://127.0.0.1:8888/callback`을 등록합니다.
- Web Playback SDK를 앱에서 사용할 수 있도록 설정합니다.

앱을 처음 실행한 뒤 상단 **설정**에서 자신의 Spotify Developer 앱 Client ID와 Redirect URI를 입력합니다. 설정값은 해당 브라우저의 로컬 저장소에 보관되며 Client Secret은 사용하지 않습니다.

## 실행

프로젝트 폴더에서:

```powershell
npm start
```

브라우저에서 [http://127.0.0.1:8888](http://127.0.0.1:8888)을 열고 **설정**에 Client ID와 `http://127.0.0.1:8888/callback`을 입력합니다. Spotify 연결을 누르면 PKCE 로그인 후 앱으로 돌아옵니다. 로그인 화면은 매번 승인 대화상자를 표시하므로 현재 계정이 다르면 Spotify 화면의 **Not you?** 링크로 다른 계정을 선택할 수 있습니다. 연결된 뒤에는 우측 상단 **Spotify 연결됨**에서 **다른 계정으로 연결** 또는 **연결 해제**를 선택합니다. `Ctrl+C`로 정적 파일 서버를 종료합니다.

## npm으로 설치

Node.js 20 이상이 설치되어 있으면 npm에서 전역으로 설치해 실행할 수 있습니다.

```powershell
npm install --global album-deck
album-deck
```

설치하지 않고 일회성으로 실행하려면 다음을 사용합니다.

```powershell
npx album-deck
```

명령을 실행하면 로컬 Album Deck 서버가 시작되고 브라우저가 열립니다. 처음 실행한 뒤 설정에서 Spotify Client ID와 Redirect URI를 입력하세요. Windows 바로가기, Node.js 자동 설치, Edge·Chrome 선택 기능이 필요한 경우에는 GitHub Releases의 Windows 배포 ZIP을 사용하세요.

## Windows 설치 및 업데이트

현재 GitHub Releases의 EXE 설치 프로그램은 사용하지 않습니다. 저장소 소스를 받아 포함된 설치 스크립트로 설치합니다.

Git을 사용하는 경우:

```powershell
git clone https://github.com/YoungkyunKong/spotify-md-rec.git
cd spotify-md-rec
.\install-windows.cmd
```

바로 설치하려면 [최신 Windows 배포 ZIP 다운로드](https://github.com/YoungkyunKong/spotify-md-rec/releases/latest/download/album-deck-windows-v1.0.1.zip)를 사용하세요. ZIP을 내려받아 압축을 푼 뒤 `install-windows.cmd`를 실행하면 됩니다.

Git을 사용하지 않는 경우 GitHub의 **Code → Download ZIP**으로 소스를 내려받아 압축을 푼 다음 `install-windows.cmd`를 더블 클릭합니다. PowerShell에서 직접 실행하려면 다음 명령을 사용합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1
```

설치 스크립트는 Node.js 20 이상을 확인합니다. Node.js가 없거나 버전이 낮으면 Windows `winget`으로 Node.js LTS를 자동 설치한 뒤 `%LOCALAPPDATA%\Programs\AlbumDeck`에 앱을 복사합니다. `winget`을 사용할 수 없는 환경에서는 Windows App Installer를 먼저 설치해야 합니다. 이후 MiniDisc 아이콘이 적용된 **Album Deck** 바로가기를 바탕 화면과 시작 메뉴에 등록합니다. 바로가기는 Edge의 독립 앱 창으로 열리며, Edge가 없으면 Chrome을 사용합니다. 주소창이나 브라우저 탭은 표시되지 않습니다.

설치 후 **Album Deck** 바로가기를 실행하고 상단 **설정**에 Spotify Client ID와 `http://127.0.0.1:8888/callback`을 입력한 다음 **Spotify 연결**을 누릅니다. Client ID, 로그인 토큰, 재생 장치와 무음 길이는 브라우저에 저장되어 앱과 PC를 다시 시작해도 유지됩니다.

업데이트할 때는 저장소에서 최신 파일을 받거나 새 ZIP을 푼 뒤 `install-windows.cmd`를 다시 실행합니다. 기존 서버를 종료하고 앱 파일과 바로가기를 갱신하며, 같은 브라우저 프로필을 사용하는 한 저장된 설정과 로그인 정보는 유지됩니다. 시작 메뉴의 **Album Deck Stop**으로 백그라운드 서버를 종료할 수 있습니다.

### Windows 배포 ZIP 만들기

Node.js가 설치된 개발 환경에서 다음 명령을 실행하면 `dist\album-deck-windows-v<현재 버전>.zip`을 만듭니다. 버전은 `package.json`에서 가져옵니다.

```powershell
npm run build:windows-zip
```

ZIP을 사용자에게 전달한 뒤 압축을 풀고 `install-windows.cmd`를 실행하면 됩니다. ZIP에는 앱 실행에 필요한 파일과 Node.js 자동 설치 기능이 있는 설치 스크립트가 포함되며, `node_modules`, `.git`, 개발용 빌드 캐시는 포함하지 않습니다.

## Vercel 배포

기존 Windows 설치와 Node.js/Render 실행 방법은 그대로 사용할 수 있습니다. Vercel에서는 웹 파일을 정적으로 제공하고 `/config.js`와 `/healthz`만 Vercel 함수로 처리합니다.

1. Vercel에서 이 GitHub 저장소를 새 프로젝트로 가져옵니다.
2. 루트 디렉터리는 저장소 최상위로 둡니다. `vercel.json`이 Framework Preset `Other`, 빌드 명령 `npm run build:vercel`, 출력 디렉터리 `public`을 지정합니다.
3. 배포 후 고정된 프로덕션 주소(예: `https://album-deck.vercel.app`)를 확인합니다.
4. Spotify Developer Dashboard의 앱에 `https://album-deck.vercel.app/callback`을 Redirect URI로 등록합니다. 실제 배포 주소로 바꾸고 주소를 정확히 일치시켜야 합니다.
5. 배포된 앱의 **설정**에서 Spotify Client ID와 동일한 Redirect URI를 입력하고 **Spotify 연결**을 누릅니다.

Client ID는 브라우저별로 저장됩니다. 여러 브라우저에 초기값을 제공하려면 Vercel 환경 변수 `SPOTIFY_CLIENT_ID`를 설정할 수 있습니다. 고정된 커스텀 도메인을 사용하는 경우 `PUBLIC_URL`을 해당 HTTPS 주소로 지정해 Redirect URI 초기값을 고정할 수도 있습니다. Client Secret은 사용하지 않습니다.

Vercel의 임시 Preview URL은 배포마다 달라질 수 있으므로 Spotify 로그인 테스트에는 Dashboard에 등록한 고정 프로덕션 도메인을 사용하세요. `/healthz`는 상태 확인용이며, 재생 상태와 곡간 무음 전환은 계속 사용자의 브라우저 탭에서 실행됩니다. 탭을 닫으면 다음 곡으로의 자동 전환도 멈춥니다.

## Node.js 앱 배포

앱은 별도 빌드 과정이나 Docker 없이 일반 Node.js 웹 서비스로 배포할 수 있습니다. 호스팅 서비스의 런타임은 Node.js 20 이상, 시작 명령은 `npm start`, 상태 확인 주소는 `/healthz`로 지정합니다. 서비스가 주입하는 `PORT`를 자동 사용하며 외부 접속을 위해 `0.0.0.0`에 바인딩합니다.

Render에서는 저장소를 연결한 뒤 루트의 `render.yaml` Blueprint를 사용하면 Node 런타임, 시작 명령과 상태 확인 경로가 자동 설정됩니다. 대시보드에서 직접 Web Service를 만들 경우 다음 값을 사용합니다.

```text
Runtime: Node
Build Command: npm install --omit=dev
Start Command: npm start
Health Check Path: /healthz
```

다른 Node 호스팅에서는 `Procfile`의 `web: npm start`를 사용할 수 있습니다. 사용자가 설정 화면에서 직접 입력하는 대신 초기값을 배포 환경에서 제공하려면 다음 환경 변수를 선택적으로 지정합니다.

```text
SPOTIFY_CLIENT_ID=your_spotify_client_id
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
- **설정**에서 Spotify Client ID와 Redirect URI를 입력하고, 이 브라우저 또는 계정에 연결된 다른 Spotify Connect 장치를 재생 대상으로 선택합니다.
- **설정**의 기본 브라우저에서 다음 실행에 사용할 Edge 또는 Chrome을 고를 수 있습니다. 선택한 브라우저가 설치되어 있지 않으면 설치된 브라우저를 자동으로 사용합니다.
- 이 브라우저로 재생할 때 **Windows 출력 설정 열기**를 눌러 브라우저 소리를 오디오 인터페이스로 보낼 수 있습니다.
- 상단의 **설정**에서 0~30초 사이의 곡간 무음을 0.5초 단위로 지정합니다. 설정은 이 브라우저에 저장됩니다.
- 아래 플레이어에서 재생·일시정지, 이전/다음 곡, 탐색과 볼륨을 조절합니다.
- 오른쪽 재생 정보와 Spotify 링크에서 현재 트랙과 앨범을 확인할 수 있습니다.
- 재생 정보와 아래 플레이어에 오디오 형식·비트레이트를 표시합니다. 이 브라우저로 재생할 때의 `AAC · 256 kbps`는 [Spotify의 웹 플레이어 안내값](https://support.spotify.com/article/audio-quality/)이며 현재 곡의 실제 전송값을 측정한 결과가 아닙니다. Spotify Connect의 다른 장치는 실제 형식·비트레이트를 확인할 수 없어 `확인 불가`로 표시합니다.

설정에서 Album Deck 브라우저 플레이어 또는 다른 Spotify Connect 장치를 선택할 수 있습니다. 곡별 대기열과 무음 전환은 이 웹 앱이 제어하므로 탭을 닫거나 장치가 절전 상태가 되면 다음 곡 전환이 중단될 수 있습니다. SDK 초기화 오류가 나면 최신 Chrome/Edge에서 보호된 콘텐츠 재생(EME)을 허용하고 다시 연결하세요.

Spotify Web Playback SDK는 Premium 계정이 필요합니다. SDK가 브라우저 안에 별도 Spotify Connect 재생 기기를 만들고, 앱은 앨범·플레이리스트의 곡 목록을 읽어 그 기기에서 한 곡씩 순서대로 재생합니다. [공식 SDK 안내](https://developer.spotify.com/documentation/web-playback-sdk), [재생 API](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback).

## 검증

```powershell
npm run check
npm start
```

Spotify 콘텐츠·앨범 표지·메타데이터는 Spotify에서 제공합니다. 본 앱은 계정 인증과 브라우저 재생만 수행하며 Spotify 음원을 다운로드하거나 파일로 저장하지 않습니다. [Spotify 이용자 지침](https://www.spotify.com/us/legal/user-guidelines/).
