FROM postgis/postgis:16-3.7-alpine@sha256:c926e34baeaa5390919e027fedd2a29c73fb8fce3844e05c9e17338617c6f239
# Tiger became an independent SQL-only extension in PostGIS 3.7.
ADD --checksum=sha256:7ef3ef6111cb320f656313236eb698dcaadb8f7d15564a8a0ce37ce537aadccf https://gitea.osgeo.org/postgis/postgis_tiger_geocoder/releases/download/2025.2/postgis_tiger_geocoder-pg16-2025.2.tar.gz /tmp/tiger.tar.gz
RUN tar -xzf /tmp/tiger.tar.gz -C /tmp \
    && cp /tmp/postgis_tiger_geocoder-pg16-2025.2/share/extension/* /usr/local/share/postgresql/extension/ \
    && rm -rf /tmp/tiger.tar.gz /tmp/postgis_tiger_geocoder-pg16-2025.2

# The upstream gosu binary embeds an obsolete Go runtime. Keep the entrypoint
# contract with Alpine's equivalent privilege-dropping utility.
RUN apk add --no-cache su-exec=0.3-r0 libxml2=2.13.9-r3 \
    && rm /usr/local/bin/gosu /usr/local/bin/su-exec \
    && sed -i 's/exec gosu postgres/exec su-exec postgres/' /usr/local/bin/docker-entrypoint.sh
