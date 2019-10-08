const _ = require('lodash');
const Serialize = require('php-serialize');

const argv = require('minimist')(process.argv.slice(2));

const db = require('mysql-promise')();

const TABLE_PREFIX = argv['table-prefix'] || 'wp_';
const SEARCH = argv.search.toLowerCase();
const REPLACE = argv.replace.toLowerCase();
console.log(argv);

db.configure({
  host: argv.host || 'localhost',
  user: argv.user || 'root',
  password: argv.password || 'password',
  database: argv.database || 'wordpress'
});

String.replacei = String.prototype.replacei = function (rep, rby) {
  const pos = this.toLowerCase().indexOf(rep.toLowerCase());
  return pos === -1 ? this : this.substr(0, pos) + rby + this.substr(pos + rep.length);
};

String.replaceiAll = String.prototype.replaceiAll = function (rep, rby) {
  let index = 0;
  let ret = this;
  do {
    ret = ret.replacei(rep, rby);
  } while ((index = ret.toLowerCase().indexOf(rep, index + 1)) > -1);

  return ret;
};


(async function () {
  const [tables] = await db.query('SHOW TABLES');
  console.log('Starting');
  for (const t of tables) {
    const table = t[Object.keys(t)[0]];
    if (table.indexOf(TABLE_PREFIX) === 0) {
      console.log('Searching', table, TABLE_PREFIX);
      const [recs, fields] = await db.query(`SELECT * FROM ${table}`);
      const [pks, pkFields] = await db.query(`SHOW KEYS FROM ${table} WHERE Key_name = 'PRIMARY'`);
      // console.log('fields', fields, pks);
      let recCount = 0;
      let phpSerCountTrySer = 0;
      let phpSerCount = 0;
      const stillIncluded = 0;
      for (const r of recs) {
        if (pks.length === 1) {
          for (const c in r) {
            let fieldVal = r[c];
            if (_.isString(fieldVal) && fieldVal.toLowerCase().includes(SEARCH)) {
              try {
                const uns = Serialize.unserialize(fieldVal);
                phpSerCountTrySer++;
                fieldVal = Serialize.serialize(JSON.parse(JSON.stringify(uns).replaceiAll(SEARCH, REPLACE)));
                phpSerCount++;
                // console.log(fieldVal)
              } catch (e) {
                fieldVal = fieldVal.replaceiAll(SEARCH, REPLACE);
                // console.log(fieldVal)
              }
              // Search string
              // console.log(`UPDATE ${table} SET ${c}=? WHERE ID=${r.ID};`, fieldVal)
              recCount++;
              await db.query(`UPDATE ${table} SET ${c}=? WHERE ${pks[0].Column_name}=${r[pks[0].Column_name]};`, [fieldVal]);
            }
          }
        }
      }
      console.log('Done Searching', table, ' - Records Changed:', recCount, ' - phpSerModifiedCount:', phpSerCount, ' - PhpSerializeTry:', phpSerCountTrySer);
    }
  }
  console.log('Done');
  process.exit(0);
  // let [records] = await db.query('SELECT * FROM wp_dlm_options')
  // console.log(tables)
}());
