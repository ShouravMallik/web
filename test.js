require('dotenv').config();
const mysql = require('mysql2');

const db = mysql.createConnection({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT
});

db.connect(err => {
    if (err) { console.log('Connect error:', err.message); return; }
    
    db.query('SET FOREIGN_KEY_CHECKS=0', () => {
        db.query('TRUNCATE TABLE items', (err) => {
            console.log(err ? 'Truncate error: ' + err.message : 'Items cleared!');
            
            db.query('SET FOREIGN_KEY_CHECKS=1', () => {
                db.query('ALTER TABLE items ADD FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE', (err) => {
                    console.log(err ? 'FK error: ' + err.message : 'FK fixed!');
                    db.end();
                });
            });
        });
    });
});