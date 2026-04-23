const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcrypt');
const path    = require('path');
const db      = require('./db');

const app = express();

// ─── MIDDLEWARE ────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'shopping_secret_key',
    resave: true,
    saveUninitialized: true,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// ─── LOGIN CHECK ───────────────────────────────────────────────
function requireLogin(req, res, next) {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    next();
}

// ─── ROOT ──────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'index.html'), (err) => {
        if (err) res.status(500).send("Index file not found ❌");
    });
});

// ─── PAGE ROUTES ───────────────────────────────────────────────
app.get('/login',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'login.html')));
app.get('/register',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'register.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'dashboard.html')));
app.get('/list',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'list.html')));

// ─── AUTH ──────────────────────────────────────────────────────
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.json({ error: 'All fields required' });
    const hashed = await bcrypt.hash(password, 10);
    db.query('INSERT INTO users (name, email, password) VALUES (?,?,?)', [name, email, hashed], (err) => {
        if (err) return res.json({ error: 'Email already exists' });
        res.json({ success: true });
    });
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

// ─── LISTS ─────────────────────────────────────────────────────
app.get('/lists/progress', requireLogin, (req, res) => {
    const userId = req.session.user.id;
    db.query(`
        SELECT l.*, 
            COUNT(i.id) as total,
            SUM(i.completed) as completed,
            SUM(i.price * i.quantity) as total_cost
        FROM lists l
        LEFT JOIN items i ON i.list_id = l.id
        WHERE l.user_id = ?
        GROUP BY l.id
        ORDER BY l.created_at DESC
    `, [userId], (err, results) => {
        if (err) return res.json([]);
        res.json(results);
    });
});

app.get('/lists', requireLogin, (req, res) => {
    const userId = req.session.user.id;
    db.query('SELECT * FROM lists WHERE user_id = ? ORDER BY created_at DESC', [userId], (err, results) => {
        if (err) return res.json([]);
        res.json(results);
    });
});

app.post('/lists', requireLogin, (req, res) => {
    const { name } = req.body;
    const userId = req.session.user.id;
    db.query('INSERT INTO lists (name, user_id) VALUES (?, ?)', [name, userId], (err, result) => {
        if (err) return res.json({ error: 'Failed to create list' });
        res.json({ success: true, id: result.insertId });
    });
});

app.delete('/lists/:id', requireLogin, (req, res) => {
    db.query('DELETE FROM lists WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id], (err) => {
        if (err) return res.json({ error: 'Failed to delete' });
        res.json({ success: true });
    });
});

// ─── ITEMS ─────────────────────────────────────────────────────
app.get('/items/:listId', requireLogin, (req, res) => {
    db.query('SELECT * FROM items WHERE list_id = ?', [req.params.listId], (err, results) => {
        if (err) return res.json([]);
        res.json(results);
    });
});

app.post('/items', requireLogin, (req, res) => {
    const { list_id, name, quantity, price } = req.body;
    db.query('INSERT INTO items (list_id, name, quantity, price, completed) VALUES (?,?,?,?,0)',
        [list_id, name, quantity || 1, price || 0], (err, result) => {
        if (err) {
            console.log('Items error:', err.message);
            return res.json({ error: 'Failed to add item' });
        }
        res.json({ success: true, id: result.insertId });
    });
});

app.put('/items/:id/full', requireLogin, (req, res) => {
    const { completed, price, quantity } = req.body;
    db.query('UPDATE items SET completed=?, price=?, quantity=? WHERE id=?',
        [completed ? 1 : 0, price, quantity, req.params.id], (err) => {
        if (err) return res.json({ error: 'Failed to update' });
        res.json({ success: true });
    });
});

app.delete('/items/:id', requireLogin, (req, res) => {
    db.query('DELETE FROM items WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.json({ error: 'Failed to delete' });
        res.json({ success: true });
    });
});

// ─── HISTORY ───────────────────────────────────────────────────
app.post('/history/add', requireLogin, (req, res) => {
    const { item_name, quantity, price } = req.body;
    const userId = req.session.user.id;
    db.query('INSERT INTO history (user_id, item_name, quantity, price) VALUES (?,?,?,?)',
        [userId, item_name, quantity, price], (err) => {
        if (err) return res.json({ error: 'Failed' });
        res.json({ success: true });
    });
});

app.get('/history/frequent', requireLogin, (req, res) => {
    const userId = req.session.user.id;
    db.query('SELECT item_name, COUNT(*) as times FROM history WHERE user_id=? GROUP BY item_name ORDER BY times DESC LIMIT 10',
        [userId], (err, results) => {
        if (err) return res.json([]);
        res.json(results);
    });
});

app.get('/history/all', requireLogin, (req, res) => {
    const userId = req.session.user.id;
    db.query('SELECT * FROM history WHERE user_id=? ORDER BY bought_at DESC LIMIT 50',
        [userId], (err, results) => {
        if (err) return res.json([]);
        res.json(results);
    });
});

// ─── STATS API ─────────────────────────────────────────────────
app.get('/stats/data', requireLogin, (req, res) => {
    const userId = req.session.user.id;
    db.query('SELECT COUNT(*) as total_lists FROM lists WHERE user_id=?', [userId], (err, lists) => {
        db.query('SELECT COUNT(*) as total_bought, SUM(price*quantity) as total_spent FROM history WHERE user_id=?', [userId], (err, bought) => {
            db.query('SELECT COUNT(*) as total, SUM(completed) as done FROM items i JOIN lists l ON i.list_id=l.id WHERE l.user_id=?', [userId], (err, items) => {
                db.query('SELECT DATE(bought_at) as day, SUM(price*quantity) as spent FROM history WHERE user_id=? GROUP BY DATE(bought_at) ORDER BY day DESC LIMIT 7', [userId], (err, weekly) => {
                    db.query('SELECT item_name, COUNT(*) as times FROM history WHERE user_id=? GROUP BY item_name ORDER BY times DESC LIMIT 8', [userId], (err, top) => {
                        const total = items[0].total || 0;
                        const done  = items[0].done  || 0;
                        res.json({
                            total_lists:     lists[0].total_lists,
                            total_bought:    bought[0].total_bought,
                            completion_rate: total > 0 ? Math.round((done / total) * 100) : 0,
                            weekly:          weekly || [],
                            top_items:       top    || []
                        });
                    });
                });
            });
        });
    });
});

// ─── GLOBAL ERROR HANDLER ──────────────────────────────────────
app.use((err, req, res, next) => {
    console.error("Global Error:", err);
    res.status(500).send("Server Error ❌");
});

// ─── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});