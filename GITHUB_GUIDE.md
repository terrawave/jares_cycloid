# 📤 GitHub 업로드 가이드

프로젝트를 GitHub에 업로드하는 단계별 가이드입니다.

## 📋 사전 준비

### 1. Git 설치

**확인:**
```bash
git --version
```

**설치 (필요시):**
- **Windows**: https://git-scm.com/download/win
- **macOS**: `brew install git`
- **Linux**: `sudo apt install git`

### 2. GitHub 계정

1. https://github.com 회원가입
2. 이메일 인증 완료

## 🚀 업로드 방법

### 방법 1: GitHub Desktop (초보자 추천)

#### 1. GitHub Desktop 설치
- https://desktop.github.com/

#### 2. 저장소 생성
1. GitHub Desktop 실행
2. **File** → **New Repository**
3. 정보 입력:
   - Name: `esp32-auto-watering`
   - Description: `ESP32 Smart Auto-Watering System`
   - Local Path: 프로젝트 폴더 선택
   - Initialize with README: 체크 해제 (이미 있음)
   - Git Ignore: None
   - License: MIT

4. **Create Repository** 클릭

#### 3. 파일 추가
1. 프로젝트 폴더의 모든 파일 복사
2. GitHub Desktop에서 변경사항 확인
3. Summary 입력: "Initial commit"
4. **Commit to main** 클릭

#### 4. GitHub에 발행
1. **Publish repository** 클릭
2. 체크박스 해제: "Keep this code private" (공개 저장소)
3. **Publish Repository** 클릭

✅ 완료! `https://github.com/yourusername/esp32-auto-watering`

---

### 방법 2: 명령줄 (Git CLI)

#### 1. 로컬 저장소 초기화

```bash
# 프로젝트 폴더로 이동
cd esp32-auto-watering

# Git 초기화
git init

# 사용자 정보 설정 (처음 한 번만)
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

#### 2. 파일 추가

```bash
# 모든 파일 추가
git add .

# 커밋
git commit -m "Initial commit: ESP32 Auto-Watering System v2.0"
```

#### 3. GitHub 저장소 생성

1. https://github.com 접속
2. 우측 상단 **+** → **New repository**
3. 정보 입력:
   - Repository name: `esp32-auto-watering`
   - Description: `ESP32 Smart Auto-Watering System`
   - Public
   - **✗ Initialize this repository with a README** (체크 해제)

4. **Create repository** 클릭

#### 4. 원격 저장소 연결 및 푸시

```bash
# 원격 저장소 추가
git remote add origin https://github.com/yourusername/esp32-auto-watering.git

# 기본 브랜치 설정
git branch -M main

# 푸시
git push -u origin main
```

✅ 완료!

---

## 🔄 이후 업데이트 방법

### GitHub Desktop
1. 파일 수정
2. GitHub Desktop에서 변경사항 확인
3. Summary 입력 (예: "Fix sensor detection bug")
4. **Commit to main** 클릭
5. **Push origin** 클릭

### Git CLI
```bash
# 변경사항 추가
git add .

# 커밋
git commit -m "Update message"

# 푸시
git push origin main
```

## 📝 좋은 커밋 메시지 작성법

### 형식
```
[타입] 간단한 설명

상세 설명 (옵션)
```

### 타입
- `feat`: 새 기능
- `fix`: 버그 수정
- `docs`: 문서 변경
- `style`: 코드 포맷팅
- `refactor`: 리팩토링
- `test`: 테스트 추가
- `chore`: 기타 작업

### 예시
```bash
git commit -m "feat: Add proximity sensor interrupt handling"
git commit -m "fix: Resolve continuous water flow issue"
git commit -m "docs: Update installation guide for macOS"
```

## 🌿 브랜치 전략 (고급)

### Feature 브랜치
```bash
# 새 기능 개발
git checkout -b feature/new-sensor-support
# ... 작업 ...
git add .
git commit -m "feat: Add MH-Z19B CO2 sensor support"
git push origin feature/new-sensor-support
```

GitHub에서 Pull Request 생성 → 리뷰 → Merge

### 버전 태그
```bash
# 릴리스 버전 태그
git tag -a v2.0 -m "Version 2.0 - Improved sensor detection"
git push origin v2.0
```

## 📊 GitHub 프로필 꾸미기

### 1. README.md 뱃지 추가

```markdown
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![ESP32](https://img.shields.io/badge/Platform-ESP32-blue.svg)](https://www.espressif.com/)
[![Python](https://img.shields.io/badge/Python-3.8+-green.svg)](https://www.python.org/)
```

### 2. 이슈 템플릿 생성

`.github/ISSUE_TEMPLATE/bug_report.md`:
```markdown
---
name: Bug report
about: Create a report to help us improve
---

**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment:**
 - OS: [e.g. Windows 10]
 - Python version: [e.g. 3.9.5]
 - ESP32 board: [e.g. DevKit V1]
```

### 3. Pull Request 템플릿

`.github/PULL_REQUEST_TEMPLATE.md`:
```markdown
## Description
Brief description of the changes

## Type of change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update

## Testing
How has this been tested?

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No new warnings
```

## 🔒 보안 설정

### .gitignore 확인

다음 파일들이 제외되었는지 확인:

```gitignore
# 민감한 정보
.env
config.local.py
*.key
*.pem

# 데이터베이스
*.db
sensor_data.db

# 로그
*.log

# Python
__pycache__/
*.pyc
venv/
```

### 시크릿 관리

GitHub에 비밀번호나 API 키를 올리지 마세요!

**환경 변수 사용:**
```python
# config.py
import os

API_KEY = os.getenv('API_KEY', 'default-value')
```

**사용자에게 안내:**
```markdown
## Configuration

Create a `.env` file:
```env
API_KEY=your-api-key-here
```
```

## 📸 스크린샷 추가

### 1. 이미지 폴더 생성
```bash
mkdir -p docs/images
```

### 2. 스크린샷 추가
- 웹 인터페이스 캡처
- 하드웨어 사진
- 회로도

### 3. README에 링크
```markdown
![Dashboard](docs/images/dashboard.png)
![Hardware](docs/images/hardware-setup.jpg)
```

## 🌟 저장소 홍보

### README.md에 추가

```markdown
## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=yourusername/esp32-auto-watering&type=Date)](https://star-history.com/#yourusername/esp32-auto-watering&Date)

## 🤝 Contributors

Thanks to these wonderful people!
```

### Topics 추가

GitHub 저장소 페이지에서:
1. ⚙️ (Settings) → Topics
2. 추가할 토픽:
   - `esp32`
   - `iot`
   - `automation`
   - `smart-agriculture`
   - `watering-system`
   - `arduino`
   - `python`
   - `fastapi`

## 📊 GitHub Actions (CI/CD)

자동 테스트 설정:

`.github/workflows/test.yml`:
```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v2
    
    - name: Set up Python
      uses: actions/setup-python@v2
      with:
        python-version: '3.9'
    
    - name: Install dependencies
      run: |
        cd backend
        pip install -r requirements.txt
    
    - name: Run tests
      run: |
        cd backend
        pytest
```

## ✅ 최종 체크리스트

업로드 전:
- [ ] `.gitignore` 확인
- [ ] README.md 완성
- [ ] LICENSE 파일 포함
- [ ] requirements.txt 최신화
- [ ] 민감한 정보 제거 확인
- [ ] 문서 링크 확인
- [ ] 이미지 경로 확인

업로드 후:
- [ ] GitHub 저장소 접속 확인
- [ ] README 렌더링 확인
- [ ] 모든 파일 업로드 확인
- [ ] License 표시 확인
- [ ] Topics 추가
- [ ] Description 작성

## 🎉 축하합니다!

프로젝트가 성공적으로 GitHub에 업로드되었습니다!

**다음 단계:**
1. 저장소 URL 공유
2. 이슈/PR 대응
3. 커뮤니티 피드백 수집
4. 지속적인 개선

**저장소 URL:**
```
https://github.com/yourusername/esp32-auto-watering
```

---

**Happy Coding! 🚀**
