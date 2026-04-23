const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcrypt');
const path    = require('path');
const db      = require('./db');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/pages', express.static(path.join(__dirname, 'public/pages')));
app.use(session({
    secret: 'shopping_secret_key',
    resave: false,
    saveUninitialized: false
}));

function requireLogin(req, res, next) {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    next();
}

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

app.get('/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/me', (req, res) => {
    if (!req.session.user) return res.json({ user: null });
    res.json({ user: req.session.user });
});

// ─── LISTS ─────────────────────────────────────────────────────
// ⚠️ /lists/progress MUST come before /lists/:id
app.get('/lists/progress', requireLogin, (req, res) => {
    db.query(
        `SELECT sl.id, sl.name, sl.created_at,
            COUNT(i.id) as total,
            SUM(i.completed) as completed,
            SUM(i.price * i.quantity) as total_cost
         FROM shopping_lists sl
         LEFT JOIN items i ON sl.id = i.list_id
         WHERE sl.user_id = ?
         GROUP BY sl.id
         ORDER BY sl.created_at DESC`,
        [req.session.user.id],
        (err, results) => {
            if (err) return res.json({ error: err.message });
            res.json(results);
        }
    );
});

app.get('/lists', requireLogin, (req, res) => {
    db.query('SELECT * FROM shopping_lists WHERE user_id = ? ORDER BY created_at DESC',
        [req.session.user.id],
        (err, results) => {
            if (err) return res.json({ error: err.message });
            res.json(results);
        }
    );
});

app.post('/lists', requireLogin, (req, res) => {
    const { name } = req.body;
    if (!name) return res.json({ error: 'List name required' });
    db.query('INSERT INTO shopping_lists (user_id, name) VALUES (?,?)',
        [req.session.user.id, name],
        (err, result) => {
            if (err) return res.json({ error: err.message });
            res.json({ success: true, id: result.insertId });
        }
    );
});

app.delete('/lists/:id', requireLogin, (req, res) => {
    db.query('DELETE FROM items WHERE list_id = ?', [req.params.id], (err) => {
        if (err) return res.json({ error: err.message });
        db.query('DELETE FROM shopping_lists WHERE id = ? AND user_id = ?',
            [req.params.id, req.session.user.id],
            (err) => {
                if (err) return res.json({ error: err.message });
                res.json({ success: true });
            }
        );
    });
});

// ─── ITEMS ─────────────────────────────────────────────────────
app.get('/items/:listId', requireLogin, (req, res) => {
    db.query('SELECT * FROM items WHERE list_id = ?', [req.params.listId], (err, results) => {
        if (err) return res.json({ error: err.message });
        res.json(results);
    });
});

app.post('/items', requireLogin, (req, res) => {
    const { list_id, name, quantity, price } = req.body;

    console.log("DEBUG:", req.body); // ← add this

    db.query(
        'INSERT INTO items (list_id, name, quantity, price) VALUES (?,?,?,?)',
        [
            list_id,
            name,
            Number(quantity) || 1,
            Number(price) || 0   // 🔥 THIS LINE FIXES IT
        ],
        (err, result) => {
            if (err) return res.json({ error: err.message });
            res.json({ success: true, id: result.insertId });
        }
    );
});

app.put('/items/:id', requireLogin, (req, res) => {
    const { completed } = req.body;
    db.query('UPDATE items SET completed = ? WHERE id = ?', [completed, req.params.id], (err) => {
        if (err) return res.json({ error: err.message });
        res.json({ success: true });
    });
});

app.put('/items/:id/full', requireLogin, (req, res) => {
    const { completed, price, quantity } = req.body;
    db.query('UPDATE items SET completed=?, price=?, quantity=? WHERE id=?',
        [completed, price || 0, quantity || 1, req.params.id],
        (err) => {
            if (err) return res.json({ error: err.message });
            res.json({ success: true });
        }
    );
});

app.delete('/items/:id', requireLogin, (req, res) => {
    db.query('DELETE FROM items WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.json({ error: err.message });
        res.json({ success: true });
    });
});
// ─── PURCHASE HISTORY ──────────────────────────────────────────

// যখন item complete হয় তখন history তে save করো
app.post('/history/add', requireLogin, (req, res) => {
    const { item_name, quantity, price } = req.body;
    db.query(
        'INSERT INTO purchase_history (user_id, item_name, quantity, price) VALUES (?,?,?,?)',
        [req.session.user.id, item_name, quantity, price || 0],
        (err) => {
            if (err) return res.json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// Frequently bought items
app.get('/history/frequent', requireLogin, (req, res) => {
    db.query(
        `SELECT item_name, COUNT(*) as times, SUM(quantity) as total_qty
         FROM purchase_history
         WHERE user_id = ?
         GROUP BY item_name
         ORDER BY times DESC
         LIMIT 8`,
        [req.session.user.id],
        (err, results) => {
            if (err) return res.json([]);
            res.json(results);
        }
    );
});

// ─── STATISTICS ────────────────────────────────────────────────

app.get('/stats', requireLogin, (req, res) => {
    const userId = req.session.user.id;

    // Total lists
    db.query('SELECT COUNT(*) as total_lists FROM shopping_lists WHERE user_id = ?', [userId], (err, lists) => {
        if (err) return res.json({ error: err.message });

        // Total items bought
        db.query('SELECT COUNT(*) as total_bought FROM purchase_history WHERE user_id = ?', [userId], (err, bought) => {
            if (err) return res.json({ error: err.message });

            // Most bought items
            db.query(
                `SELECT item_name, COUNT(*) as times
                 FROM purchase_history WHERE user_id = ?
                 GROUP BY item_name ORDER BY times DESC LIMIT 5`,
                [userId], (err, topItems) => {
                if (err) return res.json({ error: err.message });

                // Weekly spending (last 7 days)
                db.query(
                    `SELECT DATE(purchased_at) as day, SUM(price * quantity) as spent
                     FROM purchase_history
                     WHERE user_id = ? AND purchased_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                     GROUP BY DATE(purchased_at)
                     ORDER BY day ASC`,
                    [userId], (err, weekly) => {
                    if (err) return res.json({ error: err.message });

                    // Completion rate
                    db.query(
                        `SELECT 
                            COUNT(*) as total,
                            SUM(completed) as done
                         FROM items i
                         JOIN shopping_lists sl ON i.list_id = sl.id
                         WHERE sl.user_id = ?`,
                        [userId], (err, completion) => {
                        if (err) return res.json({ error: err.message });

                        const total = completion[0].total || 0;
                        const done  = completion[0].done  || 0;
                        const rate  = total > 0 ? Math.round((done / total) * 100) : 0;

                        res.json({
                            total_lists:  lists[0].total_lists,
                            total_bought: bought[0].total_bought,
                            top_items:    topItems,
                            weekly:       weekly,
                            completion_rate: rate
                        });
                    });
                });
            });
        });
    });
});
app.get('/history/all', requireLogin, (req, res) => {
    db.query(
        `SELECT * FROM purchase_history 
         WHERE user_id = ? 
         ORDER BY purchased_at DESC 
         LIMIT 50`,
        [req.session.user.id],
        (err, results) => {
            if (err) return res.json([]);
            res.json(results);
        }
    );
});
// ─── SUGGESTIONS ───────────────────────────────────────────────
app.get('/suggestions', requireLogin, (req, res) => {
    const query = req.query.q || '';
    db.query('SELECT DISTINCT name FROM items WHERE name LIKE ? LIMIT 5',
        [`%${query}%`],
        (err, results) => {
            if (err) return res.json([]);
            res.json(results.map(r => r.name));
        }
    );
});
// ─── PAGE ROUTES ───────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/pages/login.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/pages/dashboard.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/pages/register.html'));
});

// ─── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
// ─── START ─────────────────────────────────────────────────────
app.get("/test", (req, res) => {
    res.send("Server OK 🚀");
});