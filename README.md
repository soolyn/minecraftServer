# SoolynLauncher

Windows용 Soolyn 본섭 전용 Minecraft 런처입니다.

## 현재 상태

Microsoft 로그인(PKCE), Windows 암호화 로그인 저장, Java·Minecraft·Fabric 설치, 서명 및 해시 검증 기반 모드 업데이트, 중단 복구, 본섭 실행, 메모리 설정을 구현했습니다.

빈 폴더에서 실제 게임·Java·Fabric·본섭 모드 설치와 업데이트 오류 복구 테스트를 통과했습니다. **사용자 계정의 실제 로그인과 본섭 접속은 아직 검증 전입니다.** Minecraft API 앱 승인 여부도 확인해야 합니다. API 거부를 우회하거나 오프라인 계정을 생성하지 않습니다.

플레이를 누르면 계정 확인 → 설치·업데이트 → 본섭 접속을 진행합니다. 계정 없이도 `설치 / 파일 검사`는 가능합니다. `%LOCALAPPDATA%/SoolynLauncher`를 사용하며 기존 `.minecraft`를 수정하지 않습니다. 모드 업데이트는 자동이며 런처 실행 파일 자체의 새 버전은 `업데이트`에서 받습니다.

## 대상 환경

- Windows x64
- Minecraft 26.2 / Fabric Loader 0.19.5
- Microsoft 개인 계정 로그인
- GitHub Releases를 통한 업데이트 배포 예정

로그인 토큰, 비밀번호, 인증서 비밀키, 서버 월드 및 플레이어 데이터는 이 저장소에 포함하지 않습니다.

`config/launcher.json`의 Microsoft Client ID는 공개 앱 식별자이며 비밀번호가 아닙니다.

## 개발 빌드

Windows x64, Node.js 24, pnpm 11 기준입니다.

```sh
pnpm install --frozen-lockfile
pnpm bundle
pnpm test
pnpm start
pnpm dist
```

`bundle`은 공개 Release가 게시된 뒤 사용할 수 있습니다. 실행 파일은 `release/SoolynLauncher-0.1.0-x64.exe`입니다.

## 배포 운영

업데이트 공개키는 `config/update-public.pem`입니다. 비밀키는 운영 PC의 `%LOCALAPPDATA%/SoolynLauncherOperator`에만 보관하며 별도 백업이 필요합니다. 비밀키를 Git에 올리지 않습니다.

`tools/prepare-release.cjs`는 승인된 본섭 1.2.0 파일로 첫 배포본을 만드는 운영자용 도구입니다. 다음 배포는 검증한 JAR·증가한 revision·배포 URL로 새 명세를 서명하고 파일들과 함께 Release에 게시해야 합니다. 기존 키를 바꾸지 않습니다. 현재 PC의 테스트 모드를 자동 수집하지 않습니다.

라이브러리 및 프로토콜 출처: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
