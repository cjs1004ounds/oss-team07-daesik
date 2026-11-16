# 서버를 실행하는 이미지.
# 만들기: docker build -t oss-teamproject .
# 실행 방법은 docs/deploy.md에 있다.

# 개발할 때 쓰는 Node와 같은 버전. alpine은 용량이 작은 리눅스다
FROM node:24-alpine

WORKDIR /app

# 운영 모드로 실행한다 (Express가 오류 내용을 응답에 덜 싣는다)
ENV NODE_ENV=production

# 패키지 목록만 먼저 복사해서 설치한다.
# 코드만 바뀌었을 때는 이 단계를 다시 하지 않아서 빌드가 빨라진다
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 실행에 필요한 폴더만 복사한다. 테스트와 문서는 넣지 않는다
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY data/seed ./data/seed

# 실행 중에 쓰는 데이터는 /data에 둔다. 볼륨을 여기에 연결하면 컨테이너를 새로 만들어도 남는다.
# node 사용자가 쓸 수 있게 주인을 바꿔 둔다
RUN mkdir -p /data && chown node:node /data
ENV DATA_DIR=/data
ENV PORT=3000

# 관리자(root)가 아닌 사용자로 실행한다
USER node

EXPOSE 3000

# 30초마다 /api/health를 불러서 서버가 살아 있는지 확인한다
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server/index.js"]
