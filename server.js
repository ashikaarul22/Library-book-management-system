// server.js
// Run: npm init -y -&gt; npm install express express-session -&gt; node server.js
// Open: http://localhost:5000

const express = require(&quot;express&quot;);
const session = require(&quot;express-session&quot;);
const fs = require(&quot;fs&quot;);
const path = require(&quot;path&quot;);

const app = express();
const PORT = process.env.PORT || 5000;

// ---------- Helpers to read/write JSON ----------
const DATA_DIR = path.join(__dirname, &quot;data&quot;);
const FILES = {
  books: path.join(DATA_DIR, &quot;books.json&quot;),
  users: path.join(DATA_DIR, &quot;users.json&quot;),
  issued: path.join(DATA_DIR, &quot;issued.json&quot;),
  requests: path.join(DATA_DIR, &quot;requests.json&quot;),
};

function readJSON(file) {
  try {

    return JSON.parse(fs.readFileSync(file, &quot;utf-8&quot;));
  } catch {
    return [];
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- Ensure seed data ----------
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

if (!fs.existsSync(FILES.users)) {
  writeJSON(FILES.users, [
    { id: 1, username: &quot;admin&quot;, password: &quot;admin123&quot;, role: &quot;admin&quot; },
    { id: 2, username: &quot;student1&quot;, password: &quot;stud123&quot;, role: &quot;student&quot; },
  ]);
}

if (!fs.existsSync(FILES.books)) {
  writeJSON(FILES.books, [
    { id: 1, title: &quot;Clean Code&quot;, author: &quot;Robert C. Martin&quot;, available: 3 },

    { id: 2, title: &quot;Atomic Habits&quot;, author: &quot;James Clear&quot;, available: 2 },
    { id: 3, title: &quot;The Pragmatic Programmer&quot;, author: &quot;Andrew Hunt&quot;, available: 1 },
  ]);
}

if (!fs.existsSync(FILES.issued)) writeJSON(FILES.issued, []);
if (!fs.existsSync(FILES.requests)) writeJSON(FILES.requests, []);

// ---------- Middleware ----------
app.use(express.json());
app.use(
  session({
    secret: &quot;library-secret-xyz&quot;,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
  })
);
app.use(express.static(path.join(__dirname, &quot;public&quot;)));

// ---------- Small auth helpers ----------
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: &quot;Not logged in&quot; });
  next();
}

function requireRole(role) {

  return (req, res, next) =&gt; {
    if (!req.session.user || req.session.user.role !== role)
      return res.status(403).json({ error: &quot;Forbidden&quot; });
    next();
  };
}

// ---------- Auth ----------
app.post(&quot;/login&quot;, (req, res) =&gt; {
  const { username, password } = req.body || {};
  const users = readJSON(FILES.users);
  const user = users.find(u =&gt; u.username === username &amp;&amp; u.password === password);
  if (!user) return res.status(400).json({ error: &quot;Invalid credentials&quot; });

  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ success: true, role: user.role });
});

app.post(&quot;/signup&quot;, (req, res) =&gt; {
  const { username, password, role } = req.body || {};
  if (!username || !password || !role)
    return res.status(400).json({ error: &quot;Missing fields&quot; });
  if (![&quot;admin&quot;, &quot;student&quot;].includes(role))
    return res.status(400).json({ error: &quot;Invalid role&quot; });

  const users = readJSON(FILES.users);
  if (users.some(u =&gt; u.username === username))

    return res.status(400).json({ error: &quot;Username exists&quot; });

  const newUser = {
    id: users.length ? Math.max(...users.map(u =&gt; u.id)) + 1 : 1,
    username,
    password,
    role,
  };
  users.push(newUser);
  writeJSON(FILES.users, users);
  res.json({ success: true });
});

app.post(&quot;/logout&quot;, (req, res) =&gt; {
  req.session.destroy(() =&gt; res.json({ success: true }));
});

app.get(&quot;/whoami&quot;, (req, res) =&gt; {
  res.json({ user: req.session.user || null });
});

// ---------- Books (public to logged-in users) ----------
app.get(&quot;/api/books&quot;, requireLogin, (req, res) =&gt; {
  const books = readJSON(FILES.books);
  res.json(books);
});

// ---------- Student APIs ----------
app.get(&quot;/api/mybooks&quot;, requireRole(&quot;student&quot;), (req, res) =&gt; {
  const issued = readJSON(FILES.issued);
  const mine = issued.filter(
    i =&gt; i.username === req.session.user.username &amp;&amp; !i.return_date
  );
  res.json(mine);
});

app.get(&quot;/api/myrequests&quot;, requireRole(&quot;student&quot;), (req, res) =&gt; {
  const requests = readJSON(FILES.requests);
  const mine = requests.filter(
    r =&gt; r.username === req.session.user.username &amp;&amp; r.status === &quot;pending&quot;
  );
  res.json(mine);
});

app.post(&quot;/api/request-borrow&quot;, requireRole(&quot;student&quot;), (req, res) =&gt; {
  const { bookId } = req.body || {};
  if (!bookId) return res.status(400).json({ error: &quot;bookId required&quot; });

  const books = readJSON(FILES.books);
  const book = books.find(b =&gt; b.id === Number(bookId));
  if (!book) return res.status(404).json({ error: &quot;Book not found&quot; });
  if (book.available &lt;= 0) return res.status(400).json({ error: &quot;No copies available&quot; });

  const requests = readJSON(FILES.requests);

  if (
    requests.some(
      r =&gt;
        r.username === req.session.user.username &amp;&amp;
        r.bookId === book.id &amp;&amp;
        r.type === &quot;borrow&quot; &amp;&amp;
        r.status === &quot;pending&quot;
    )
  ) {
    return res.status(400).json({ error: &quot;You already have a pending borrow request&quot; });
  }

  const newReq = {
    id: requests.length ? Math.max(...requests.map(r =&gt; r.id)) + 1 : 1,
    type: &quot;borrow&quot;,
    username: req.session.user.username,
    bookId: book.id,
    title: book.title,
    requested_at: new Date().toISOString(),
    status: &quot;pending&quot;,
  };
  requests.push(newReq);
  writeJSON(FILES.requests, requests);
  res.json({ success: true });
});

app.post(&quot;/api/request-return&quot;, requireRole(&quot;student&quot;), (req, res) =&gt; {

  const { bookId } = req.body || {};
  if (!bookId) return res.status(400).json({ error: &quot;bookId required&quot; });

  const issued = readJSON(FILES.issued);
  const open = issued.find(
    i =&gt; i.username === req.session.user.username &amp;&amp; i.bookId === Number(bookId) &amp;&amp;
!i.return_date
  );
  if (!open) return res.status(400).json({ error: &quot;No active issue for this book&quot; });

  const requests = readJSON(FILES.requests);
  if (
    requests.some(
      r =&gt;
        r.username === req.session.user.username &amp;&amp;
        r.bookId === Number(bookId) &amp;&amp;
        r.type === &quot;return&quot; &amp;&amp;
        r.status === &quot;pending&quot;
    )
  ) {
    return res.status(400).json({ error: &quot;You already have a pending return request&quot; });
  }

  const newReq = {
    id: requests.length ? Math.max(...requests.map(r =&gt; r.id)) + 1 : 1,
    type: &quot;return&quot;,
    username: req.session.user.username,
    bookId: Number(bookId),

    title: open.title,
    requested_at: new Date().toISOString(),
    status: &quot;pending&quot;,
  };
  requests.push(newReq);
  writeJSON(FILES.requests, requests);
  res.json({ success: true });
});

// ---------- Admin APIs ----------
app.post(&quot;/api/books&quot;, requireRole(&quot;admin&quot;), (req, res) =&gt; {
  const { title, author, available } = req.body || {};
  if (!title || !author)
    return res.status(400).json({ error: &quot;title &amp; author required&quot; });

  const books = readJSON(FILES.books);
  const newBook = {
    id: books.length ? Math.max(...books.map(b =&gt; b.id)) + 1 : 1,
    title,
    author,
    available: Math.max(0, Number(available || 1)),
  };
  books.push(newBook);
  writeJSON(FILES.books, books);
  res.json({ success: true, book: newBook });
});

app.delete(&quot;/api/books/:id&quot;, requireRole(&quot;admin&quot;), (req, res) =&gt; {
  const bookId = Number(req.params.id);
  const issued = readJSON(FILES.issued);
  if (issued.some(i =&gt; i.bookId === bookId &amp;&amp; !i.return_date)) {
    return res.status(400).json({ error: &quot;Cannot delete: book has active issues&quot; });
  }
  const books = readJSON(FILES.books);
  const next = books.filter(b =&gt; b.id !== bookId);
  writeJSON(FILES.books, next);
  res.json({ success: true });
});

app.get(&quot;/api/issued&quot;, requireRole(&quot;admin&quot;), (req, res) =&gt; {
  const issued = readJSON(FILES.issued);
  res.json(issued);
});

app.get(&quot;/api/requests&quot;, requireRole(&quot;admin&quot;), (req, res) =&gt; {
  const requests = readJSON(FILES.requests);
  res.json(requests.filter(r =&gt; r.status === &quot;pending&quot;));
});

app.post(&quot;/api/requests/approve&quot;, requireRole(&quot;admin&quot;), (req, res) =&gt; {
  const { requestId } = req.body || {};
  if (!requestId) return res.status(400).json({ error: &quot;requestId required&quot; });

  const requests = readJSON(FILES.requests);

  const reqItem = requests.find(r =&gt; r.id === Number(requestId) &amp;&amp; r.status === &quot;pending&quot;);
  if (!reqItem) return res.status(404).json({ error: &quot;Request not found&quot; });

  const books = readJSON(FILES.books);
  const issued = readJSON(FILES.issued);
  const book = books.find(b =&gt; b.id === reqItem.bookId);

  if (reqItem.type === &quot;borrow&quot;) {
    if (!book || book.available &lt;= 0)
      return res.status(400).json({ error: &quot;Book not available&quot; });
    book.available -= 1;
    const issue = {
      id: issued.length ? Math.max(...issued.map(i =&gt; i.id)) + 1 : 1,
      username: reqItem.username,
      bookId: book.id,
      title: book.title,
      issue_date: today(),
      return_date: null,
    };
    issued.push(issue);
  } else if (reqItem.type === &quot;return&quot;) {
    const open = issued.find(
      i =&gt; i.username === reqItem.username &amp;&amp; i.bookId === reqItem.bookId &amp;&amp; !i.return_date
    );
    if (!open) return res.status(400).json({ error: &quot;No open issue found&quot; });
    open.return_date = today();
    if (book) book.available += 1;

  }

  reqItem.status = &quot;approved&quot;;
  writeJSON(FILES.requests, requests);
  writeJSON(FILES.books, books);
  writeJSON(FILES.issued, issued);
  res.json({ success: true });
});

app.post(&quot;/api/requests/reject&quot;, requireRole(&quot;admin&quot;), (req, res) =&gt; {
  const { requestId } = req.body || {};
  const requests = readJSON(FILES.requests);
  const reqItem = requests.find(r =&gt; r.id === Number(requestId) &amp;&amp; r.status === &quot;pending&quot;);
  if (!reqItem) return res.status(404).json({ error: &quot;Request not found&quot; });

  reqItem.status = &quot;rejected&quot;;
  writeJSON(FILES.requests, requests);
  res.json({ success: true });
});

// ---------- Pages ----------
app.get(&quot;/&quot;, (req, res) =&gt;
  res.sendFile(path.join(__dirname, &quot;public&quot;, &quot;auth.html&quot;))
);
app.get(&quot;/admin&quot;, (req, res) =&gt;
  res.sendFile(path.join(__dirname, &quot;public&quot;, &quot;admin.html&quot;))
);

app.get(&quot;/student&quot;, (req, res) =&gt;
  res.sendFile(path.join(__dirname, &quot;public&quot;, &quot;student.html&quot;))
);
app.get(&quot;/admin-dashboard&quot;, (req, res) =&gt;
  res.sendFile(path.join(__dirname, &quot;public&quot;, &quot;admin-dashboard.html&quot;))
);

// ---------- Start Server ----------
app.listen(PORT, () =&gt; {
  console.log(`Server running at http://localhost:${PORT}`);
});
