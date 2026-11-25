FROM golang:1.27.4-alpine3.24@sha256:70bd7ddea8b6cbe5d6943cde279d6b67feb10cc924fb9100d1d8757c1575b280 AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go .
RUN CGO_ENABLED=0 go build -mod=readonly -trimpath -o /caddy .
RUN go version -m /caddy | awk '$1=="dep" && $2=="github.com/go-jose/go-jose/v3" {old=1} $1=="dep" && $2=="github.com/go-jose/go-jose/v4" {fixed=1} END {exit(old || !fixed)}'

FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
RUN apk add --no-cache --upgrade zlib=1.4-r0
COPY --from=builder /caddy /usr/bin/caddy
