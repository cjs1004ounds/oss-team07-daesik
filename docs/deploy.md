# 배포

배포 주소: https://daesik.duckdns.org

처음에는 kwfood.duckdns.org로 올렸다가 서비스 이름이 정해진 뒤 주소를 하나 더 붙였습니다. 두 주소 모두 같은 서버로 연결됩니다.

AWS EC2 한 대에서 Docker 컨테이너로 서버를 실행하고, 앞에 nginx를 둬서 https를 처리합니다. 코드를 올리는 건 서버에 접속해서 명령으로 직접 합니다.

아래는 2026년 11월에 실제로 만든 순서입니다. AWS 콘솔의 메뉴 이름은 바뀔 수 있어서 무엇을 만드는지 위주로 적었습니다.

## 구성

```
인터넷
  |
daesik.duckdns.org, kwfood.duckdns.org (탄력적 IP)
  |
인터넷 게이트웨이
  |
VPC 10.0.0.0/16
  └─ 퍼블릭 서브넷 10.0.0.0/20
       └─ EC2 (Ubuntu 26.04, t3.micro)
            ├─ 보안 그룹: 80, 443번만 열림
            ├─ IAM 역할: Session Manager 접속용
            ├─ nginx: 80은 https로 넘기고, 443에서 인증서 처리
            └─ Docker
                 └─ 컨테이너 oss-app (메모리 512MB)
                      ├─ 127.0.0.1:3000 (서버 안에서만 접근)
                      └─ 볼륨 oss-data -> /data (가게, 한 줄 추천 같은 기록 JSON)
```

요청은 nginx가 받아서 컨테이너로 넘깁니다. 컨테이너의 3000번은 밖에서 직접 닿지 않습니다.

## 1. 내 컴퓨터에서 먼저 확인

Docker가 설치돼 있으면 올리기 전에 똑같이 돌려 볼 수 있습니다. `.env`가 있어야 합니다.

```
docker build -t oss-teamproject .

docker run -d --name oss-app --init --restart unless-stopped -p 3080:3000 --memory 512m --env-file .env -e DATA_DIR=/data -v oss-data:/data oss-teamproject
```

http://localhost:3080 으로 들어가서 확인합니다. 끝나면 지웁니다.

```
docker rm -f oss-app
```

윈도우의 Git Bash에서는 `/data`가 윈도우 경로로 바뀌어서 오류가 납니다. PowerShell에서 실행하거나 명령 앞에 `MSYS_NO_PATHCONV=1`을 붙입니다.

### 옵션이 하는 일

| 옵션 | 하는 일 |
| --- | --- |
| `--init` | 멈추라는 신호를 Node에 전달해서 `docker stop`이 바로 끝나게 함 |
| `--restart unless-stopped` | 서버가 죽거나 EC2가 재부팅돼도 다시 뜸 |
| `-p 127.0.0.1:3000:3000` | 서버 자신만 3000번으로 접근할 수 있게 함. 밖에서는 nginx를 거쳐야 함 |
| `--memory 512m` | 수업 조건인 512MB 안에서 도는지 확인 |
| `--env-file .env` | API 키를 이미지에 넣지 않고 실행할 때 넘김 |
| `-e DATA_DIR=/data` | 데이터를 볼륨이 연결된 `/data`에 쓰게 함 |
| `-v oss-data:/data` | 컨테이너를 지우고 새로 만들어도 기록이 남음 |

`-e DATA_DIR=/data`를 빼면 안 됩니다. `.env`에 `DATA_DIR=`가 빈 값으로 들어 있으면 이미지에 정해 둔 값을 덮어써서, 볼륨이 아닌 곳에 쓰려다 권한 오류가 납니다.

## 2. AWS 계정과 IAM

- 루트 계정에는 MFA를 걸고 평소에는 쓰지 않습니다.
- EC2에 붙일 역할을 하나 만듭니다.
  - 이름: `oss-ec2-role`
  - 신뢰할 대상: EC2
  - 권한 정책: `AmazonSSMManagedInstanceCore` 하나만
  - 이 역할이 있으면 SSH 키 없이 콘솔의 Session Manager로 서버에 접속할 수 있습니다.
- 서버 안에 AWS 액세스 키를 넣지 않습니다. 서버가 AWS의 다른 기능을 쓸 일이 생기면 이 역할에 권한을 추가합니다.

## 3. 네트워크 (VPC)

리전은 서울(ap-northeast-2)입니다. VPC 만들기 화면에서 "VPC 등"을 고르면 아래 네 가지가 한 번에 만들어집니다.

| 만든 것 | 값 |
| --- | --- |
| VPC | `oss-vpc`, 10.0.0.0/16 |
| 퍼블릭 서브넷 | 가용 영역 하나(ap-northeast-2a), 10.0.0.0/20 |
| 인터넷 게이트웨이 | `oss-igw` |
| 라우팅 테이블 | `oss-rtb-public`, 0.0.0.0/0 -> 인터넷 게이트웨이 |

프라이빗 서브넷은 0개, NAT 게이트웨이와 VPC 엔드포인트는 "없음"으로 합니다. NAT 게이트웨이는 시간당 요금이 나오고, 서버가 퍼블릭 서브넷에 있어서 필요 없습니다.

보안 그룹 `oss-web-sg`

| 방향 | 유형 | 소스 또는 대상 |
| --- | --- | --- |
| 인바운드 | HTTP (80) | 0.0.0.0/0 |
| 인바운드 | HTTPS (443) | 0.0.0.0/0 |
| 아웃바운드 | 모든 트래픽 | 0.0.0.0/0 |

- 22번(SSH)은 열지 않습니다. 접속은 Session Manager로 합니다.
- 80번은 http로 들어온 요청을 https로 넘기는 용도와, 인증서를 발급하고 갱신할 때 확인 요청을 받는 용도로 열어 둡니다.
- 아웃바운드를 열어 두는 이유는 서버가 카카오 API, GitHub, 패키지 저장소에 나가야 하고, Session Manager도 서버가 AWS 쪽으로 연결을 거는 방식이기 때문입니다.

## 4. EC2

| 항목 | 값 |
| --- | --- |
| 이름 | `oss-server` |
| 이미지 | Ubuntu Server 26.04 LTS, 64비트(x86) |
| 유형 | t3.micro (메모리 1GB) |
| 키 페어 | 없이 진행 (Session Manager로 접속) |
| 네트워크 | `oss-vpc`, 퍼블릭 서브넷, 퍼블릭 IP 자동 할당 켜기 |
| 보안 그룹 | 기존 그룹 `oss-web-sg` 선택. 새로 만들지 않기 |
| 저장 장치 | gp3 20GB, 암호화 켜기 (기본 키) |
| IAM 인스턴스 프로파일 | `oss-ec2-role` |
| 메타데이터 버전 | V2만 (토큰 필수) |

인스턴스를 만든 뒤 탄력적 IP를 하나 받아서 연결합니다. 안 하면 인스턴스를 껐다 켤 때 주소가 바뀝니다. 탄력적 IP는 인스턴스에 연결하지 않은 채로 두면 요금이 나옵니다.

t3 계열은 크레딧 사양이 기본으로 "무제한"입니다. 하루 평균 CPU 사용이 기준을 넘으면 추가 요금이 붙습니다. 이 서버는 CPU를 거의 안 써서 그대로 뒀고, 요금을 확실히 막으려면 "표준"으로 바꿉니다.

## 5. 주소 연결 (DuckDNS)

https://www.duckdns.org 에서 하위 주소를 만들고 IP 칸에 탄력적 IP를 넣습니다. IP 칸에는 처음에 지금 쓰는 컴퓨터의 IP가 자동으로 들어가 있어서 꼭 바꿔야 합니다.

DuckDNS 화면의 token은 비밀번호 같은 값이라 저장소나 채팅에 올리지 않습니다.

### 주소를 하나 더 붙일 때

서비스 이름이 정해져서 `daesik` 주소를 추가할 때 한 순서입니다. 서버에서 한 줄씩 실행합니다.

1. DuckDNS에서 새 하위 주소를 만들고 같은 탄력적 IP를 넣습니다.
2. 카카오 디벨로퍼스의 JavaScript SDK 도메인에 새 주소를 추가합니다. 안 하면 새 주소에서 지도가 안 뜹니다.
3. nginx 설정의 `server_name`에 새 주소를 추가하고 반영합니다.

```
sudo sed -i 's/server_name kwfood.duckdns.org;/server_name daesik.duckdns.org kwfood.duckdns.org;/' /etc/nginx/sites-available/oss
sudo nginx -t
sudo systemctl reload nginx
```

4. 기존 인증서에 새 주소를 더합니다.

```
sudo certbot --nginx -d kwfood.duckdns.org -d daesik.duckdns.org --expand --redirect
```

## 6. 서버에 올리기

콘솔에서 인스턴스를 고르고 "연결"에서 Session Manager로 접속합니다.

Session Manager 창에서는 여러 줄을 한 번에 붙여 넣으면 일부만 실행되거나 줄이 붙어 버립니다. 명령은 한 줄씩 붙이고 Enter를 누릅니다.

### Docker 설치와 코드 받기

```
cd ~
sudo apt update
sudo apt install -y docker.io git
git clone https://github.com/cjs1004ounds/oss-team07-daesik.git
cd oss-team07-daesik
```

### API 키 넣기

이 파일은 서버에만 있고 저장소에는 올라가지 않습니다.

```
cp .env.example .env
nano .env
chmod 600 .env
```

`nano`에서 `KAKAO_REST_API_KEY=` 뒤에 키를 넣고 `Ctrl+O`, `Enter`로 저장한 뒤 `Ctrl+X`로 나옵니다.

넣는 값은 아래와 같습니다. 설명은 `.env.example`에도 있습니다.

| 이름 | 쓰는 곳 | 비워 두면 |
| --- | --- | --- |
| `KAKAO_REST_API_KEY` | 가게 검색 (카카오 로컬 API) | 가게 검색이 502 |
| `KAKAO_JS_KEY` | 첫 화면 지도 (카카오맵) | 지도가 안 뜨고 안내 글자만 나옴 |
| `GEMINI_API_KEY` | LLM 기능 전부 (칸 채우기, 작성 전 검사, 신고 판단, 검색, 요약 등) | LLM 없이 동작. 나머지 기능은 그대로 |
| `GEMINI_MODEL` | 쓸 Gemini 모델 | `server/llm.js`의 기본 모델 |
| `LLM_DAILY_LIMIT` | 서버 전체의 하루 LLM 호출 한도 | `server/llm.js`의 기본값 |
| `CAMPUS_IP_PREFIXES` | 교내 인증의 학교 와이파이 판정 (R12) | 와이파이 판정 없이 위치로만 인증 |

- 키와 학교 와이파이의 IP 값은 이 파일에만 넣습니다. 저장소, 이슈, 채팅에는 올리지 않습니다.
- `.env`를 고친 뒤에는 "7. 코드를 바꾼 뒤 다시 올리기"처럼 컨테이너를 지우고 새로 만들어야 합니다. `--env-file`은 컨테이너를 만들 때 한 번만 읽어서 `docker restart`로는 반영되지 않습니다.
- `CAMPUS_IP_PREFIXES`가 맞게 동작하려면 서버가 nginx 뒤에서 접속한 사람의 IP를 읽어야 합니다. `deploy/nginx/oss.conf`가 `X-Forwarded-For`를 넘기고, 서버는 `server/app.js`의 `trust proxy` 설정으로 그 값을 읽습니다.

### 이미지 만들고 실행

```
sudo docker build -t oss-teamproject .
```

```
sudo docker run -d --name oss-app --init --restart unless-stopped -p 127.0.0.1:3000:3000 --memory 512m --env-file .env -e DATA_DIR=/data -v oss-data:/data oss-teamproject
```

```
curl localhost:3000/api/health
```

`{"status":"ok"}`가 나오면 됩니다.

### nginx 설치와 설정

nginx가 80번을 쓰기 때문에, 컨테이너가 80번을 쓰고 있으면 먼저 위 명령처럼 `127.0.0.1:3000`으로 옮겨야 합니다.

```
sudo apt install -y nginx certbot python3-certbot-nginx
```

저장소에 있는 설정 파일을 복사해서 켭니다.

```
sudo cp deploy/nginx/oss.conf /etc/nginx/sites-available/oss
sudo ln -s /etc/nginx/sites-available/oss /etc/nginx/sites-enabled/oss
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

`nginx -t`에서 `syntax is ok`가 나온 뒤에 `reload`를 합니다. 주소가 바뀌면 `deploy/nginx/oss.conf`의 `server_name`도 바꿔야 합니다.

### https 인증서

Let's Encrypt에서 무료 인증서를 받습니다. 이메일과 약관 동의를 물어봅니다.

```
sudo certbot --nginx -d daesik.duckdns.org -d kwfood.duckdns.org --redirect
```

- certbot이 `/etc/nginx/sites-available/oss`에 https 설정을 직접 추가합니다. 그래서 서버의 파일은 저장소의 파일보다 줄이 더 많습니다.
- `--redirect`는 http로 들어온 요청을 https로 넘기게 합니다.
- 인증서는 90일짜리이고 자동으로 갱신됩니다. `sudo systemctl list-timers | grep certbot`으로 확인합니다.

### 확인

```
curl -I https://daesik.duckdns.org/api/health
sudo docker ps
sudo docker stats --no-stream
```

LLM 키가 들어갔는지는 칸 채우기 API로 봅니다.

```
curl -s -X POST localhost:3000/api/reviews/draft -H 'Content-Type: application/json' -d '{"text":"jeyuk 7000won"}'
```

`"source":"llm"`이 나오면 Gemini가 답한 것이고, `"source":"empty"`면 키가 없거나 호출이 실패한 것입니다. 실패한 이유는 `sudo docker logs oss-app`에 남습니다.

## 7. 코드를 바꾼 뒤 다시 올리기

main에 합쳐도 서버는 자동으로 바뀌지 않습니다. 서버에 접속해서 한 줄씩 실행합니다. 볼륨은 그대로 두기 때문에 기록은 남습니다.

저장소 이름을 바꾸기 전에 받아 둔 서버는 폴더 이름이 `oss-teamproject`입니다. 그 서버에서는 첫 줄을 `cd ~/oss-teamproject`로 합니다.

```
cd ~/oss-team07-daesik
git pull
sudo docker build -t oss-teamproject .
sudo docker rm -f oss-app
sudo docker run -d --name oss-app --init --restart unless-stopped -p 127.0.0.1:3000:3000 --memory 512m --env-file .env -e DATA_DIR=/data -v oss-data:/data oss-teamproject
```

컨테이너를 지우고 새로 만드는 몇 초 동안은 nginx가 502를 돌려줍니다. nginx는 다시 시작하지 않아도 됩니다.

## 8. 기록 백업, 지우기, 시드

기록은 볼륨 `oss-data`(컨테이너 안의 `/data`)에 JSON 파일로 있습니다.

| 파일 | 내용 |
| --- | --- |
| `places.json` | 기록이 있는 가게 |
| `reviews.json` | 한 줄 추천 |
| `visits.json` | 다녀왔어요 응답 |
| `verifications.json` | 교내 인증 |
| `rooms.json` | 같이 정하기 방 |
| `reports.json` | 신고 |
| `statuses.json` | 지금 상황 제보 |
| `priceRanges.json` | LLM에게 받아 둔 종류별 보통 가격 범위 |

### 백업

볼륨 안의 `backup` 폴더에 복사해 둡니다.

```
sudo docker exec oss-app sh -c 'mkdir -p /data/backup && cp /data/*.json /data/backup/ && ls /data/backup'
```

서버 밖으로 꺼내 두려면 EC2의 홈 폴더로 복사합니다.

```
sudo docker cp oss-app:/data ~/data-backup
```

자동으로 하는 백업은 없습니다. 기록을 지우거나 시드를 넣기 전에 직접 합니다.

### 시험 기록 지우기

시험하면서 남긴 기록을 지울 때 씁니다. 교내 인증(`verifications.json`)과 가격 범위(`priceRanges.json`)는 남깁니다. 지운 뒤에 바로 다시 시작해야 합니다. 서버가 기록을 메모리에 들고 있어서, 다시 시작하지 않으면 다음 저장 때 지운 기록이 파일에 다시 써집니다.

```
sudo docker exec oss-app sh -c 'cd /data && rm -f places.json reviews.json visits.json reports.json statuses.json rooms.json && ls'
sudo docker restart oss-app
```

### 시드 데이터

저장소의 `data/seed`에 있는 파일은 이미지에 같이 들어갑니다. 서버는 켤 때 파일마다 `/data`에 그 파일이 있으면 그것을 읽고, 없을 때만 `data/seed`의 같은 이름 파일을 읽습니다(`server/store.js`).

- 그래서 `/data`에 `places.json`이 이미 있으면 시드를 바꿔서 올려도 반영되지 않습니다.
- 시드를 새로 넣으려면 새 이미지로 올린 뒤(7번), 위의 "시험 기록 지우기"로 `/data`의 파일을 지우고 다시 시작합니다. 이때 서버에 쌓인 기록은 사라지니 먼저 백업합니다.
- 시드로 읽은 기록은 누가 처음 기록을 남기는 순간 `/data`의 파일에 같이 써집니다. 그 뒤로는 `/data`의 파일이 기준입니다.

## 9. 잘 안 될 때

| 증상 | 볼 곳 |
| --- | --- |
| 브라우저에서 안 열림 | 보안 그룹 80, 443번, 탄력적 IP 연결, `sudo systemctl status nginx` |
| 502 Bad Gateway | 컨테이너가 떠 있는지 `sudo docker ps`, 로그는 `sudo docker logs oss-app` |
| IP 주소로 들어가면 404 | 정상. 인증서가 도메인 이름에만 있어서 도메인으로 들어가야 함 |
| 가게 검색이 오류 | `.env`의 카카오 키, 카카오 앱의 카카오맵 사용 설정 |
| 저장이 안 됨 | 실행 명령에 `-e DATA_DIR=/data`와 `-v oss-data:/data`가 있는지 |
| 지도가 안 나옴 | 카카오 디벨로퍼스의 JavaScript 키에 배포 주소를 등록했는지 |
| LLM 기능이 안 됨 (칸 채우기가 비어서 옴, 요약이 안 나옴) | `.env`의 `GEMINI_API_KEY`, `sudo docker logs oss-app`의 실패 이유. 하루 한도나 사람별 한도를 넘었을 수도 있음 (`docs/api.md`의 "LLM 호출 제한") |
| `.env`를 고쳤는데 그대로임 | 컨테이너를 지우고 새로 만들었는지. `docker restart`로는 반영되지 않음 |
| 학교 와이파이인데 교내 인증이 위치를 물어봄 | `.env`의 `CAMPUS_IP_PREFIXES`, nginx 설정에 `X-Forwarded-For`가 있는지 |
| 시드를 바꿨는데 안 보임 | `/data`에 같은 이름 파일이 있으면 시드를 읽지 않음. "8. 기록 백업, 지우기, 시드" |
| Session Manager 연결이 안 됨 | 인스턴스에 `oss-ec2-role`이 붙어 있는지, 퍼블릭 IP가 있는지 |

저장된 데이터는 `sudo docker exec oss-app ls -l /data`로 봅니다.

## 요금

계정마다 프리 티어 조건이 달라서 직접 확인해야 합니다.

- 인스턴스를 만들 때 콘솔에 나오는 프리 티어 표시를 봅니다.
- 요금이 나올 수 있는 것: NAT 게이트웨이, 인스턴스에 연결하지 않은 탄력적 IP, 프리 티어 범위를 넘는 인스턴스 유형이나 디스크, 퍼블릭 IPv4 주소, t3의 "무제한" 크레딧
- AWS Budgets에서 예산 알림을 걸어 두면 요금이 생길 때 메일이 옵니다.
- 프로젝트가 끝나면 인스턴스를 종료하고, 탄력적 IP를 릴리스하고, VPC를 지웁니다.

## 아직 안 한 것

- 머지하면 자동으로 올라가게 하는 것. 수업 조건(자동 배포 서비스 금지)에 걸리는지 확인한 뒤 정합니다.
- 자동 백업. 지금은 8번처럼 직접 복사하고, 기록은 EC2 디스크의 볼륨에만 있습니다.
