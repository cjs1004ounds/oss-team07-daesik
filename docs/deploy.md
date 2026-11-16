# 배포

AWS EC2 한 대에서 Docker 컨테이너로 서버를 실행합니다. 코드를 올리는 건 서버에 접속해서 명령으로 직접 합니다.

AWS 콘솔의 메뉴 이름은 바뀔 수 있어서, 아래에는 무엇을 만드는지만 적었습니다.

## 구성

```
인터넷
  |
인터넷 게이트웨이
  |
VPC 10.0.0.0/16
  └─ 퍼블릭 서브넷 10.0.1.0/24
       └─ EC2 (Ubuntu, 탄력적 IP)
            ├─ 보안 그룹: 80번만 열림
            ├─ IAM 역할: Session Manager 접속용
            └─ Docker
                 └─ 컨테이너 oss-app (메모리 512MB)
                      ├─ 80 -> 3000 포트
                      └─ 볼륨 oss-data -> /data (가게, 한 줄 추천 JSON)
```

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
| `-p 80:3000` | 주소 뒤에 포트 번호 없이 들어올 수 있게 함 |
| `--memory 512m` | 수업 조건인 512MB 안에서 도는지 확인 |
| `--env-file .env` | API 키를 이미지에 넣지 않고 실행할 때 넘김 |
| `-e DATA_DIR=/data` | 데이터를 볼륨이 연결된 `/data`에 쓰게 함 |
| `-v oss-data:/data` | 컨테이너를 지우고 새로 만들어도 기록이 남음 |

`-e DATA_DIR=/data`를 빼면 안 됩니다. `.env`에 `DATA_DIR=`가 빈 값으로 들어 있으면 이미지에 정해 둔 값을 덮어써서, 볼륨이 아닌 곳에 쓰려다 권한 오류가 납니다.

## 2. AWS 계정과 IAM

- 루트 계정에는 MFA를 걸고 평소에는 쓰지 않습니다.
- 콘솔에 들어갈 IAM 사용자를 따로 만들고 여기에도 MFA를 겁니다.
- EC2에 붙일 역할을 하나 만듭니다.
  - 신뢰할 대상: EC2
  - 권한 정책: `AmazonSSMManagedInstanceCore` 하나만
  - 이 역할이 있으면 SSH 키 없이 콘솔의 Session Manager로 서버에 접속할 수 있습니다.
- 서버 안에 AWS 액세스 키를 넣지 않습니다. 서버가 AWS의 다른 기능을 쓸 일이 생기면 이 역할에 권한을 추가합니다.

## 3. 네트워크 (VPC)

리전은 서울(ap-northeast-2)입니다.

| 만들 것 | 값 |
| --- | --- |
| VPC | 10.0.0.0/16 |
| 서브넷 | 10.0.1.0/24, 가용 영역 하나. 퍼블릭 IPv4 자동 할당 켜기 |
| 인터넷 게이트웨이 | 만들어서 VPC에 연결 |
| 라우팅 테이블 | 0.0.0.0/0 -> 인터넷 게이트웨이. 위 서브넷에 연결 |
| 보안 그룹 | 인바운드: 80번(HTTP)을 0.0.0.0/0에서 허용. 아웃바운드: 전부 허용 |

- NAT 게이트웨이는 만들지 않습니다. 시간당 요금이 나오고, 서버가 퍼블릭 서브넷에 있어서 필요 없습니다.
- 22번(SSH)은 열지 않습니다. 접속은 Session Manager로 합니다. SSH를 꼭 써야 하면 22번을 내 IP에서만 허용합니다.
- 아웃바운드를 열어 두는 이유는 서버가 카카오 API, GitHub, 패키지 저장소에 나가야 하기 때문입니다.

## 4. EC2

| 항목 | 값 |
| --- | --- |
| 이미지 | Ubuntu Server 24.04 LTS |
| 유형 | t3.micro 또는 t2.micro (메모리 1GB. 프리 티어에 해당하는 쪽) |
| 네트워크 | 위에서 만든 VPC, 서브넷, 보안 그룹 |
| IAM 인스턴스 프로파일 | 2번에서 만든 역할 |
| 저장 장치 | gp3 8GB |
| 메타데이터 | IMDSv2 필수로 설정 |

인스턴스를 만든 뒤 탄력적 IP를 하나 받아서 연결합니다. 안 하면 인스턴스를 껐다 켤 때 주소가 바뀝니다.

## 5. 서버에 올리기

콘솔에서 인스턴스를 고르고 Session Manager로 접속합니다. 접속이 안 되면 역할이 붙어 있는지, 서브넷의 라우팅이 인터넷 게이트웨이로 가는지 확인합니다.

```
sudo apt update
sudo apt install -y docker.io git

cd ~
git clone https://github.com/cjs1004ounds/oss-teamproject.git
cd oss-teamproject
```

API 키를 넣을 `.env`를 만듭니다. 이 파일은 서버에만 있고 저장소에는 올라가지 않습니다.

```
cp .env.example .env
nano .env        # KAKAO_REST_API_KEY= 뒤에 키를 넣고 저장
chmod 600 .env
```

이미지를 만들고 실행합니다.

```
sudo docker build -t oss-teamproject .

sudo docker run -d --name oss-app --init --restart unless-stopped -p 80:3000 --memory 512m --env-file .env -e DATA_DIR=/data -v oss-data:/data oss-teamproject
```

확인합니다.

```
curl localhost/api/health          # {"status":"ok"}
sudo docker ps                     # STATUS에 healthy
sudo docker stats --no-stream      # 메모리 사용량
```

브라우저에서 `http://탄력적IP`로 들어가서 첫 화면과 가게 검색이 되는지 봅니다.

## 6. 코드를 바꾼 뒤 다시 올리기

main에 합친 뒤 서버에 접속해서 합니다. 볼륨은 그대로 두기 때문에 기록은 남습니다.

```
cd ~/oss-teamproject
git pull
sudo docker build -t oss-teamproject .
sudo docker rm -f oss-app
sudo docker run -d --name oss-app --init --restart unless-stopped -p 80:3000 --memory 512m --env-file .env -e DATA_DIR=/data -v oss-data:/data oss-teamproject
```

컨테이너를 지우고 새로 만드는 몇 초 동안은 접속이 안 됩니다.

## 7. 잘 안 될 때

| 증상 | 볼 곳 |
| --- | --- |
| 브라우저에서 안 열림 | 보안 그룹 80번, 탄력적 IP 연결, `sudo docker ps`에 컨테이너가 떠 있는지 |
| 가게 검색이 오류 | `.env`의 카카오 키, 카카오 앱의 카카오맵 사용 설정. `sudo docker logs oss-app`에 이유가 나옴 |
| 저장이 안 됨 | 실행 명령에 `-e DATA_DIR=/data`와 `-v oss-data:/data`가 있는지 |
| 지도가 안 나옴 | 카카오 디벨로퍼스에 배포 주소(`http://탄력적IP`)를 등록했는지 |

로그는 `sudo docker logs oss-app`, 저장된 데이터는 `sudo docker exec oss-app ls -l /data`로 봅니다.

## 요금

계정마다 프리 티어 조건이 달라서 직접 확인해야 합니다.

- 인스턴스를 만들 때 콘솔에 나오는 프리 티어 표시를 봅니다.
- 요금이 나올 수 있는 것: NAT 게이트웨이, 인스턴스에 연결하지 않은 탄력적 IP, 프리 티어 범위를 넘는 인스턴스 유형이나 디스크, 퍼블릭 IPv4 주소
- AWS Budgets에서 예산 알림을 걸어 두면 요금이 생길 때 메일이 옵니다.
- 프로젝트가 끝나면 인스턴스, 탄력적 IP, VPC를 지웁니다.

## 아직 안 한 것

- https. 도메인이 있어야 해서 지금은 `http://IP`로만 엽니다.
- 머지하면 자동으로 올라가게 하는 것. 수업 조건(자동 배포 서비스 금지)에 걸리는지 확인한 뒤 정합니다.
- 데이터 백업. 지금은 EC2 디스크의 볼륨에만 있습니다.
