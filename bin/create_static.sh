#!/bin/bash


#sudo wget --restrict-file-names=windows -P ./data/html-static --adjust-extension --mirror --page-requisites --convert-links http://localhost
mkdir -p ./data/html-static/localhost

docker run --network=host -it -v "${PWD}/data/html-static":/data --entrypoint bash dsheyp/docker-httrack -c "httrack 'http://localhost/' -O '/data' '+*.localhost/*' --disable-security-limits -s3 --max-rate=100000000 --sockets=50 -%v"

sudo chown -R www-data:www-data ./data/html-static

exit 0
