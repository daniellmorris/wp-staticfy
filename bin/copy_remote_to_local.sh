#!/bin/sh -e

### SSH File Config ###
eval $(cat ./data/config.dotfile)

### Merge configuration ###
STDIR="./data/src-html";
STDATABASE="./data/src-database";
TDIR="./data/html";
REWRITE_URL_TO="http://localhost";

echo 'starting rsync'

sudo rsync -e "/usr/bin/ssh" --compress --stats -rlDHS $SUSER@$SHOST:$SDIR/* $STDIR

WPDBHOST=`cat $STDIR/wp-config.php | grep DB_HOST | cut -d \' -f 4`;
WPDBNAME=`cat $STDIR/wp-config.php | grep DB_NAME | cut -d \' -f 4`;
WPDBUSER=`cat $STDIR/wp-config.php | grep DB_USER | cut -d \' -f 4`;
WPDBPASS=`cat $STDIR/wp-config.php | grep DB_PASSWORD | cut -d \' -f 4`;
WPDBPREFIX=`cat $STDIR/wp-config.php | grep table_prefix | cut -d \' -f 2`;

TWPDBHOST=`cat $TDIR/wp-config.php | grep DB_HOST | cut -d \' -f 4`;
TWPDBNAME=`cat $TDIR/wp-config.php | grep DB_NAME | cut -d \' -f 4`;
TWPDBUSER=`cat $TDIR/wp-config.php | grep DB_USER | cut -d \' -f 4`;
TWPDBPASS=`cat $TDIR/wp-config.php | grep DB_PASSWORD | cut -d \' -f 4`;

echo 'finished rsync, grabbing database'

#FILE=$SDIR/mysql-$WPDBNAME.sql.gz;        # Set the backup filename
#echo "mysqldump -q -u $WPDBUSER -h $WPDBHOST -p$WPDBPASS $WPDBNAME | gzip -9 > $FILE";

ssh $SUSER@$SHOST "mysqldump -q -u $WPDBUSER -h $WPDBHOST -p$WPDBPASS $WPDBNAME | gzip -9 > backup.sql.gz"

scp $SUSER@$SHOST:./backup.sql.gz .              # copy all the files to backup server
ssh $SUSER@$SHOST rm ./backup.sql.gz             # delete files on db server

gunzip -d backup.sql.gz
#sed -i "s/$SOURCE_URL/$REWRITE_URL_TO/g" backup.sql
sudo mv backup.sql $STDATABASE
sudo chown root:root $STDATABASE/backup.sql
# mysql -u root -e "CREATE DATABASE IF NOT EXISTS $WPDBNAME"
# mysql -u root -e "GRANT ALL PRIVILEGES ON $WPDBNAME.* To 'wp'@'localhost'"
# mysql -u wp -pwp $WPDBNAME < backup.sql

#docker-compose exec db mysql
docker-compose exec db mysql -u $TWPDBUSER -p$TWPDBPASS -e "DROP DATABASE IF EXISTS $TWPDBNAME"
docker-compose exec db mysql -u $TWPDBUSER -p$TWPDBPASS -e "CREATE DATABASE IF NOT EXISTS $TWPDBNAME"
docker-compose exec db mysql -u $TWPDBUSER -p$TWPDBPASS -e "GRANT ALL PRIVILEGES ON $TWPDBNAME.* To '$TWPDBUSER'@'localhost'"
docker-compose exec db bash -c "mysql -u $TWPDBUSER -p$TWPDBPASS $TWPDBNAME < /var/lib/mysql-src/backup.sql"

node ./bin/search_replace_database.js --host=localhost --password=$TWPDBPASS --user=$TWPDBUSER --database=$TWPDBNAME --table-prefix=$WPDBPREFIX --search $SOURCE_URL --replace $REWRITE_URL_TO
# Update url
####docker-compose exec db mysql -u $TWPDBUSER -p$TWPDBPASS $TWPDBNAME -e "UPDATE ${WPDBPREFIX}options SET option_value = replace(option_value, '$SOURCE_URL', '$REWRITE_URL_TO') WHERE option_name = 'home' OR option_name = 'siteurl'"
#####docker-compose exec db mysql -u $TWPDBUSER -p$TWPDBPASS $TWPDBNAME -e "UPDATE ${WPDBPREFIX}options SET option_value = replace(option_value, '$SOURCE_URL', '$REWRITE_URL_TO')"
####docker-compose exec db mysql -u $TWPDBUSER -p$TWPDBPASS $TWPDBNAME -e "UPDATE ${WPDBPREFIX}posts SET guid = replace(guid, '$SOURCE_URL','$REWRITE_URL_TO')"
####docker-compose exec db mysql -u $TWPDBUSER -p$TWPDBPASS $TWPDBNAME -e "UPDATE ${WPDBPREFIX}posts SET post_content = replace(post_content, '$SOURCE_URL', '$REWRITE_URL_TO')"
####docker-compose exec db mysql -u $TWPDBUSER -p$TWPDBPASS $TWPDBNAME -e "UPDATE ${WPDBPREFIX}postmeta SET meta_value = replace(meta_value,'$SOURCE_URL','$REWRITE_URL_TO')"

sudo sed -i "/DB_HOST/s/'[^']*'/'$TWPDBHOST'/2" $STDIR/wp-config.php
sudo sed -i "/DB_NAME/s/'[^']*'/'$TWPDBNAME'/2" $STDIR/wp-config.php
sudo sed -i "/DB_USER/s/'[^']*'/'$TWPDBUSER'/2" $STDIR/wp-config.php
sudo sed -i "/DB_PASSWORD/s/'[^']*'/'$TWPDBPASS'/2" $STDIR/wp-config.php

# sudo rsync -rlDHS $STDIR/* $STDIR
sudo cp -R $STDIR/* $TDIR

sudo chown -R www-data:www-data $TDIR
