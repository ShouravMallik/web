const mysql = require('mysql2');

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'choity5',
    database: 'shopping_app'
});

db.connect((err) => {
    if (err) {
        console.log('Database connection failed:', err.message);
        return;
    }
    console.log('Connected to MySQL database.');
});

module.exports = db;