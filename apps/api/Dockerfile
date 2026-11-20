FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
RUN npm ci --workspace apps/api --include=dev --no-audit --no-fund
COPY apps/api ./apps/api
COPY contracts ./contracts
RUN npm run build --workspace apps/api

FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
RUN npm ci --workspace apps/api --omit=dev --no-audit --no-fund \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm
RUN apk add --no-cache --upgrade zlib=1.4-r0
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY contracts ./contracts
COPY apps/api/scripts/database.cjs ./apps/api/scripts/database.cjs
COPY apps/api/scripts/classify-water.cjs ./apps/api/scripts/classify-water.cjs
COPY apps/api/scripts/ars.cjs ./apps/api/scripts/ars.cjs
COPY apps/api/scripts/amenities.cjs ./apps/api/scripts/amenities.cjs
COPY apps/api/scripts/score-coverage.cjs ./apps/api/scripts/score-coverage.cjs
COPY apps/api/scripts/catalogue-zone*.cjs ./apps/api/scripts/
COPY apps/api/migrations ./apps/api/migrations
COPY apps/api/seeds ./apps/api/seeds
WORKDIR /app/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||'3000')+'/api/beaches?limit=1',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# Optional daily geodata import. The API image itself does not ship Python or extracts.
FROM runtime AS geo-build
USER root
RUN apk add --no-cache g++ cmake samurai python3-dev py3-pip py3-scikit-build-core py3-pybind11-dev \
    boost-dev expat-dev bzip2-dev zlib-dev lz4-dev curl \
    && curl -fsSL -o /tmp/osmium-4.3.1.tar.gz https://files.pythonhosted.org/packages/f9/2e/b5a4204a8f809205e5b1fe31a409882c6d408ae9babfb7eed72b1f5e7c74/osmium-4.3.1.tar.gz \
    && echo '5cc16af5f0f34d5e67c678433f6ddda6e37f086ab3cf4ac3b15725fd878f75a8  /tmp/osmium-4.3.1.tar.gz' | sha256sum -c - \
    && CMAKE_BUILD_PARALLEL_LEVEL=2 pip install --no-deps --no-build-isolation --target /opt/geo /tmp/osmium-4.3.1.tar.gz

FROM runtime AS inventories
USER root
WORKDIR /app
RUN apk add --no-cache python3 py3-shapely py3-requests curl libexpat libbz2 lz4-libs \
    && mkdir /cache && chown node:node /cache
COPY --from=geo-build /opt/geo /opt/geo
COPY scripts/prepare-amenities.py scripts/territory-inventories.py scripts/inventory-cycle.sh ./scripts/
USER node
ENV PYTHONPATH=/opt/geo
HEALTHCHECK NONE
CMD ["sh","scripts/inventory-cycle.sh"]

FROM runtime AS api
