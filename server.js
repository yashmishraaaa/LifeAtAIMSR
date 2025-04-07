const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const multer = require('multer');
const bcrypt = require('bcrypt');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: '.' }),
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

const db = new sqlite3.Database('lifeataimsr.db', (err) => {
  if (err) console.error(err);
  console.log('Connected to SQLite');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    name TEXT,
    course TEXT,
    batch TEXT,
    bio TEXT,
    profilePic TEXT DEFAULT 'default-profile.png'
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    groupId INTEGER,
    content TEXT,
    image TEXT,
    isPublic INTEGER,
    likes INTEGER DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    postId INTEGER,
    userId INTEGER,
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    creatorId INTEGER,
    isPreCreated INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupId INTEGER,
    userId INTEGER,
    status TEXT DEFAULT 'pending'
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    followId INTEGER,
    type TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senderId INTEGER,
    receiverId INTEGER,
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`INSERT OR IGNORE INTO users (email, password, name, course, batch, bio) 
          VALUES (?, ?, ?, ?, ?, ?)`, 
          ['student1@aimsr.edu', bcrypt.hashSync('pass123', 10), 'Student One', 'MCA', '2023', 'Hey!']);
  db.run(`INSERT OR IGNORE INTO users (email, password, name, course, batch, bio) 
          VALUES (?, ?, ?, ?, ?, ?)`, 
          ['student2@aimsr.edu', bcrypt.hashSync('pass123', 10), 'Student Two', 'BCA', '2024', 'Hi there!']);
  db.run(`INSERT OR IGNORE INTO groups (name, creatorId, isPreCreated) 
          VALUES (?, ?, ?)`, ['Batch 2023', 1, 1]);
});

const requireLogin = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/');
  next();
};

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

app.post('/register', (req, res) => {
  const { email, password, name, course, batch } = req.body;
  if (!email.endsWith('@aimsr.edu')) return res.send('Only AIMSR emails allowed');
  const hashedPassword = bcrypt.hashSync(password, 10);
  db.run(`INSERT INTO users (email, password, name, course, batch, bio) 
          VALUES (?, ?, ?, ?, ?, '')`, 
          [email, hashedPassword, name, course, batch], (err) => {
    if (err) return res.send('Registration failed. Email might be taken.');
    res.redirect('/');
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email.endsWith('@aimsr.edu')) return res.send('Only AIMSR emails allowed');
  db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
    if (err || !user || !bcrypt.compareSync(password, user.password)) 
      return res.send('Login failed. Check credentials.');
    req.session.userId = user.id;
    res.redirect('/feed');
  });
});

app.get('/feed', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'feed.html')));

app.get('/posts', requireLogin, (req, res) => {
  db.all(`SELECT p.*, u.name, g.name AS groupName 
          FROM posts p 
          JOIN users u ON p.userId = u.id 
          LEFT JOIN groups g ON p.groupId = g.id 
          WHERE p.isPublic = 1 OR p.userId IN (SELECT followId FROM follows WHERE userId = ? AND type = 'user')
          OR p.groupId IN (SELECT followId FROM follows WHERE userId = ? AND type = 'group')
          ORDER BY p.timestamp DESC`, [req.session.userId, req.session.userId], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.get('/comments/:postId', requireLogin, (req, res) => {
  db.all(`SELECT c.*, u.name FROM comments c JOIN users u ON c.userId = u.id WHERE c.postId = ?`, 
         [req.params.postId], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

// app.post('/post', requireLogin, upload.single('image'), (req, res) => {
//   const { content, groupId, isPublic } = req.body;
//   const image = req.file ? req.file.filename : null;
//   db.run(`INSERT INTO posts (userId, groupId, content, image, isPublic) 
//           VALUES (?, ?, ?, ?, ?)`, [req.session.userId, groupId || null, content, image, isPublic ? 1 : 0], (err) => {
//     if (err) return res.status(500).send('Post failed');
//     res.redirect('/feed');
//   });
// });

app.post('/post', requireLogin, upload.single('image'), (req, res) => {
  let { content, groupId } = req.body;
  const image = req.file ? req.file.filename : null;
  const isPublic = groupId === "public" ? 1 : 0; // Check if "Public Post" is selected

  db.run(
    `INSERT INTO posts (userId, groupId, content, image, isPublic) 
     VALUES (?, ?, ?, ?, ?)`,
    [req.session.userId, isPublic ? null : groupId || null, content, image, isPublic],
    (err) => {
      if (err) return res.status(500).send('Post failed');
      res.redirect('/feed');
    }
  );
});

app.post('/like/:postId', requireLogin, (req, res) => {
  db.run(`UPDATE posts SET likes = likes + 1 WHERE id = ?`, [req.params.postId], (err) => {
    if (err) return res.status(500).send('Like failed');
    res.redirect('/feed');
  });
});

app.post('/comment/:postId', requireLogin, (req, res) => {
  const { content } = req.body;
  db.run(`INSERT INTO comments (postId, userId, content) VALUES (?, ?, ?)`, 
         [req.params.postId, req.session.userId, content], (err) => {
    if (err) return res.status(500).send('Comment failed');
    res.redirect('/feed');
  });
});

app.get('/profile', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));

app.get('/user', requireLogin, (req, res) => {
  db.get(`SELECT * FROM users WHERE id = ?`, [req.session.userId], (err, row) => {
    if (err) return res.status(500).json({});
    res.json(row);
  });
});

app.post('/update-profile', requireLogin, upload.single('profilePic'), (req, res) => {
  const { bio } = req.body;
  const profilePic = req.file ? req.file.filename : null;
  db.run(`UPDATE users SET bio = ?, profilePic = COALESCE(?, profilePic) WHERE id = ?`, 
         [bio, profilePic, req.session.userId], (err) => {
    if (err) return res.status(500).send('Update failed');
    res.redirect('/profile');
  });
});

app.get('/groups', requireLogin, (req, res) => {
  db.all(`SELECT g.*, gm.status FROM groups g 
          LEFT JOIN group_members gm ON g.id = gm.groupId AND gm.userId = ?`, 
         [req.session.userId], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.post('/create-group', requireLogin, (req, res) => {
  const { name } = req.body;
  db.run(`INSERT INTO groups (name, creatorId, isPreCreated) VALUES (?, ?, 0)`, 
         [name, req.session.userId], (err) => {
    if (err) return res.status(500).send('Group creation failed');
    res.redirect('/feed');
  });
});

app.post('/join-group', requireLogin, (req, res) => {
  const { groupId } = req.body;
  db.run(`INSERT OR IGNORE INTO group_members (groupId, userId) VALUES (?, ?)`, 
         [groupId, req.session.userId], (err) => {
    if (err) return res.status(500).send('Join request failed');
    res.redirect('/feed');
  });
});

app.post('/follow', requireLogin, (req, res) => {
  const { followId, type } = req.body;
  db.run(`INSERT OR IGNORE INTO follows (userId, followId, type) VALUES (?, ?, ?)`, 
         [req.session.userId, followId, type], (err) => {
    if (err) return res.status(500).send('Follow failed');
    res.redirect('/feed');
  });
});

app.get('/users', requireLogin, (req, res) => {
  db.all(`SELECT id, name FROM users WHERE id != ?`, [req.session.userId], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

app.get('/messages', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'messages.html')));

app.get('/chat/:receiverId', requireLogin, (req, res) => {
  db.all(`SELECT m.*, u.name AS senderName 
          FROM messages m JOIN users u ON m.senderId = u.id 
          WHERE (m.senderId = ? AND m.receiverId = ?) OR (m.senderId = ? AND m.receiverId = ?) 
          ORDER BY m.timestamp`, 
         [req.session.userId, req.params.receiverId, req.params.receiverId, req.session.userId], (err, rows) => {
    if (err) return res.status(500).json([]);
    res.json(rows);
  });
});

// app.post('/send-message', requireLogin, (req, res) => {
//   const { receiverId, content } = req.body;
//   db.run(`INSERT INTO messages (senderId, receiverId, content) VALUES (?, ?, ?)`, 
//          [req.session.userId, receiverId, content], (err) => {
//     if (err) return res.status(500).send('Message failed');
//     res.redirect(`/messages?receiverId=${receiverId}`);
//   });
// });

app.post('/send-message', requireLogin, (req, res) => {
  const { receiverId, content } = req.body;
  console.log("Receiver ID:", receiverId);
  console.log("Content:", content);
  console.log("Sender ID:", req.session.userId);

  if (!receiverId || !content) {
    return res.status(400).send("Error: Missing receiver or message content");
  }

  db.run(
    `INSERT INTO messages (senderId, receiverId, content) VALUES (?, ?, ?)`, 
    [req.session.userId, receiverId, content], 
    (err) => {
      if (err) {
        console.error("Database Error:", err);
        return res.status(500).send("Message failed");
      }
      res.redirect(`/messages?receiverId=${receiverId}`);
    }
  );
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));