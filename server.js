const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcrypt');
const path    = require('path');
const db      = require('./db');

const app = express();

// ─── MIDDLEWARE ────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// static files (VERY IMPORTANT)
app.use(express.static(path.join(__dirname, 'public')));

// session
app.use(session({
    secret: 'shopping_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Railway HTTP use kore, tai false
}));

// ─── LOGIN CHECK ───────────────────────────────────────────────
function requireLogin(req, res, next) {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    next();
}

// ─── ROOT FIX (MOST IMPORTANT 🔥) ───────────────────────────────
app.get('/', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'pages', 'index.html');

    res.sendFile(filePath, (err) => {
        if (err) {
            console.error("Root file error:", err);
            res.status(500).send("Index file not found ❌");
        }
    });
});

// ─── PAGE ROUTES ───────────────────────────────────────────────
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'register.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'dashboard.html'));
});

app.get('/list', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'list.html'));
});

app.get('/history', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'history.html'));
});

app.get('/stats', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'stats.html'));
});

// ─── AUTH ──────────────────────────────────────────────────────
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.json({ error: 'All fields required' });

    const hashed = await bcrypt.hash(password, 10);

    db.query(
        'INSERT INTO users (name, email, password) VALUES (?,?,?)',
        [name, email, hashed],
        (err) => {
            if (err) return res.json({ error: 'Email already exists' });
            res.json({ success: true });
        }
    );
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
        if (err || results.length === 0) return res.json({ error: 'User not found' });

        const user = results[0];
        const match = await bcrypt.compare(password, user.password);

        if (!match) return res.json({ error: 'Wrong password' });

        req.session.user = { id: user.id, name: user.name };
        res.json({ success: true });
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/me', (req, res) => {
    res.json({ user: req.session.user || null });
});
app.get('/', (req, res) => {
    res.send("Server OK ✅");
});


// ─── GLOBAL ERROR HANDLER (IMPORTANT) ───────────────────────────
app.use((err, req, res, next) => {
    console.error("Global Error:", err);
    res.status(500).send("Server Error ❌");
});

// ─── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});