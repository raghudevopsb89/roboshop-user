FROM docker.io/mongo:7-jammy
COPY master-data.js /db/master-data.js
COPY run.sh /run.sh
RUN chmod +x /run.sh
ENTRYPOINT ["bash", "/run.sh"]
