require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET";

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "ecommerce_db",
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10
});

async function initDatabase() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    port: process.env.DB_PORT || 3306
  });

  await db.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || "ecommerce_db"}`);
  await db.end();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(160) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('customer','admin','super_admin') DEFAULT 'customer',
      email_verified BOOLEAN DEFAULT FALSE,
      verify_token VARCHAR(255),
      reset_token VARCHAR(255),
      status ENUM('active','disabled') DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(160) UNIQUE NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      category_id INT NULL,
      name VARCHAR(180) NOT NULL,
      description TEXT,
      price DECIMAL(12,2) NOT NULL,
      stock INT DEFAULT 0,
      image VARCHAR(255),
      discount DECIMAL(5,2) DEFAULT 0,
      sold INT DEFAULT 0,
      status ENUM('active','inactive','deleted') DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS carts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity INT DEFAULT 1,
      UNIQUE KEY unique_cart(user_id, product_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wishlists (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      product_id INT NOT NULL,
      UNIQUE KEY unique_wishlist(user_id, product_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS addresses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      full_name VARCHAR(120),
      phone VARCHAR(40),
      address_line VARCHAR(255),
      city VARCHAR(120),
      country VARCHAR(80) DEFAULT 'Kenya'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS coupons (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(80) UNIQUE NOT NULL,
      type ENUM('percent','fixed') DEFAULT 'percent',
      value DECIMAL(12,2) NOT NULL,
      active BOOLEAN DEFAULT TRUE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      address_id INT NULL,
      subtotal DECIMAL(12,2),
      discount DECIMAL(12,2),
      tax DECIMAL(12,2),
      shipping DECIMAL(12,2),
      total DECIMAL(12,2),
      status ENUM('pending','paid','processing','shipped','delivered','cancelled','refunded') DEFAULT 'pending',
      payment_method VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL,
      price DECIMAL(12,2) NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      method VARCHAR(50),
      amount DECIMAL(12,2),
      status ENUM('pending','paid','failed','refunded') DEFAULT 'pending',
      transaction_ref VARCHAR(160),
      gateway_response JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      product_id INT NOT NULL,
      rating INT NOT NULL,
      comment TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      action VARCHAR(160),
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      setting_key VARCHAR(120) UNIQUE,
      setting_value TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      plan_name VARCHAR(120),
      status VARCHAR(40) DEFAULT 'trial',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`INSERT IGNORE INTO categories(id,name,slug) VALUES
    (1,'Electronics','electronics'),
    (2,'Fashion','fashion'),
    (3,'Home','home')
  `);

  await pool.query(`INSERT IGNORE INTO products(id,category_id,name,description,price,stock,image,discount) VALUES
    (1,1,'Wireless Headphones','Premium noise cancelling headphones',4500,25,'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800',5),
    (2,1,'Smart Watch','Fitness and notification smart watch',7200,18,'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800',0),
    (3,2,'Leather Sneakers','Comfortable casual sneakers',3500,40,'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800',10),
    (4,3,'Desk Lamp','Modern LED desk lamp',2200,8,'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800',0)
  `);

  const [admins] = await pool.query(`SELECT id FROM users WHERE role='super_admin' LIMIT 1`);
  if (!admins.length) {
    const hash = await bcrypt.hash("Admin12345", 12);
    await pool.query(
      `INSERT INTO users(name,email,password_hash,role,email_verified) VALUES(?,?,?,?,1)`,
      ["Super Admin", "admin@example.com", hash, "super_admin"]
    );
  }

  console.log("Database ready");
}

function tokenFor(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Login required" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

function adminOnly(req, res, next) {
  if (!["admin", "super_admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

function superOnly(req, res, next) {
  if (req.user.role !== "super_admin") {
    return res.status(403).json({ error: "Super admin only" });
  }
  next();
}

async function log(userId, action, details = "") {
  await pool.query(
    `INSERT INTO activity_logs(user_id,action,details) VALUES(?,?,?)`,
    [userId || null, action, details]
  );
}

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || ""
  }
});

async function sendEmail(to, subject, html) {
  if (!process.env.SMTP_USER) return;
  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html
  });
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* AUTH */

app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password || password.length < 8) {
    return res.status(400).json({ error: "Name, email and 8+ character password required" });
  }

  const hash = await bcrypt.hash(password, 12);
  const verifyToken = crypto.randomBytes(24).toString("hex");

  try {
    await pool.query(
      `INSERT INTO users(name,email,password_hash,verify_token) VALUES(?,?,?,?)`,
      [name, email, hash, verifyToken]
    );

    const link = `${req.protocol}://${req.get("host")}/api/verify/${verifyToken}`;
    await sendEmail(email, "Verify your account", `<a href="${link}">Verify Email</a>`);

    res.json({ message: "Registered successfully. Verify email if SMTP is configured." });
  } catch {
    res.status(409).json({ error: "Email already exists" });
  }
});

app.get("/api/verify/:token", async (req, res) => {
  const [r] = await pool.query(
    `UPDATE users SET email_verified=1, verify_token=NULL WHERE verify_token=?`,
    [req.params.token]
  );
  res.send(r.affectedRows ? "Email verified" : "Invalid token");
});

app.post("/api/login", async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM users WHERE email=?`, [req.body.email]);
  const user = rows[0];

  if (!user || !(await bcrypt.compare(req.body.password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (user.status !== "active") return res.status(403).json({ error: "Account disabled" });

  res.json({
    token: tokenFor(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

app.post("/api/forgot-password", async (req, res) => {
  const reset = crypto.randomBytes(24).toString("hex");
  await pool.query(`UPDATE users SET reset_token=? WHERE email=?`, [reset, req.body.email]);

  const link = `${req.protocol}://${req.get("host")}/?reset=${reset}`;
  await sendEmail(req.body.email, "Password reset", `<a href="${link}">Reset Password</a>`);

  res.json({ message: "Reset email sent if account exists" });
});

app.post("/api/reset-password", async (req, res) => {
  const { token, password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: "Password too short" });

  const hash = await bcrypt.hash(password, 12);
  const [r] = await pool.query(
    `UPDATE users SET password_hash=?, reset_token=NULL WHERE reset_token=?`,
    [hash, token]
  );

  res.json({ message: r.affectedRows ? "Password changed" : "Invalid reset token" });
});

/* CUSTOMER */

app.get("/api/me", auth, async (req, res) => {
  const [[user]] = await pool.query(
    `SELECT id,name,email,role,email_verified,status FROM users WHERE id=?`,
    [req.user.id]
  );
  res.json(user);
});

app.put("/api/me", auth, async (req, res) => {
  await pool.query(`UPDATE users SET name=? WHERE id=?`, [req.body.name, req.user.id]);
  res.json({ message: "Profile updated" });
});

/* PRODUCTS */

app.get("/api/products", async (req, res) => {
  const q = `%${req.query.q || ""}%`;
  const category = req.query.category || "";
  const sort = req.query.sort || "new";

  const order =
    sort === "price_asc" ? "p.price ASC" :
    sort === "price_desc" ? "p.price DESC" :
    sort === "best" ? "p.sold DESC" :
    "p.created_at DESC";

  const [rows] = await pool.query(
    `SELECT p.*, c.name category_name, c.slug category_slug
     FROM products p
     LEFT JOIN categories c ON c.id=p.category_id
     WHERE p.status='active'
     AND p.name LIKE ?
     AND (?='' OR c.slug=?)
     ORDER BY ${order}`,
    [q, category, category]
  );

  res.json(rows);
});

app.get("/api/categories", async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM categories ORDER BY name`);
  res.json(rows);
});

app.get("/api/products/:id", async (req, res) => {
  const [[product]] = await pool.query(`SELECT * FROM products WHERE id=?`, [req.params.id]);
  const [reviews] = await pool.query(
    `SELECT r.*, u.name FROM reviews r JOIN users u ON u.id=r.user_id WHERE product_id=?`,
    [req.params.id]
  );
  res.json({ product, reviews });
});

/* CART */

app.get("/api/cart", auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.*, p.name, p.price, p.image, p.stock, p.discount
     FROM carts c JOIN products p ON p.id=c.product_id
     WHERE c.user_id=?`,
    [req.user.id]
  );
  res.json(rows);
});

app.post("/api/cart", auth, async (req, res) => {
  await pool.query(
    `INSERT INTO carts(user_id,product_id,quantity)
     VALUES(?,?,?)
     ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity)`,
    [req.user.id, req.body.product_id, req.body.quantity || 1]
  );
  res.json({ message: "Added to cart" });
});

app.patch("/api/cart/:id", auth, async (req, res) => {
  await pool.query(
    `UPDATE carts SET quantity=? WHERE id=? AND user_id=?`,
    [req.body.quantity, req.params.id, req.user.id]
  );
  res.json({ message: "Cart updated" });
});

app.delete("/api/cart/:id", auth, async (req, res) => {
  await pool.query(`DELETE FROM carts WHERE id=? AND user_id=?`, [req.params.id, req.user.id]);
  res.json({ message: "Removed" });
});

/* WISHLIST */

app.get("/api/wishlist", auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT w.id wishlist_id, p.* FROM wishlists w JOIN products p ON p.id=w.product_id WHERE w.user_id=?`,
    [req.user.id]
  );
  res.json(rows);
});

app.post("/api/wishlist", auth, async (req, res) => {
  await pool.query(
    `INSERT IGNORE INTO wishlists(user_id,product_id) VALUES(?,?)`,
    [req.user.id, req.body.product_id]
  );
  res.json({ message: "Added to wishlist" });
});

app.delete("/api/wishlist/:id", auth, async (req, res) => {
  await pool.query(`DELETE FROM wishlists WHERE id=? AND user_id=?`, [req.params.id, req.user.id]);
  res.json({ message: "Removed" });
});

/* ADDRESSES */

app.get("/api/addresses", auth, async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM addresses WHERE user_id=?`, [req.user.id]);
  res.json(rows);
});

app.post("/api/addresses", auth, async (req, res) => {
  const { full_name, phone, address_line, city, country } = req.body;
  await pool.query(
    `INSERT INTO addresses(user_id,full_name,phone,address_line,city,country) VALUES(?,?,?,?,?,?)`,
    [req.user.id, full_name, phone, address_line, city, country || "Kenya"]
  );
  res.json({ message: "Address saved" });
});

/* ORDERS */

app.post("/api/orders", auth, async (req, res) => {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [items] = await conn.query(
      `SELECT c.*, p.price, p.stock, p.discount
       FROM carts c JOIN products p ON p.id=c.product_id
       WHERE c.user_id=?`,
      [req.user.id]
    );

    if (!items.length) throw new Error("Cart empty");

    let subtotal = 0;
    for (const item of items) {
      if (item.quantity > item.stock) throw new Error("Insufficient stock");
      subtotal += Number(item.price) * item.quantity * (1 - Number(item.discount || 0) / 100);
    }

    let discount = 0;
    if (req.body.coupon) {
      const [[coupon]] = await conn.query(`SELECT * FROM coupons WHERE code=? AND active=1`, [req.body.coupon]);
      if (coupon) {
        discount = coupon.type === "percent" ? subtotal * Number(coupon.value) / 100 : Number(coupon.value);
      }
    }

    const tax = Math.max(subtotal - discount, 0) * 0.16;
    const shipping = subtotal > 10000 ? 0 : 500;
    const total = subtotal - discount + tax + shipping;

    const [order] = await conn.query(
      `INSERT INTO orders(user_id,address_id,subtotal,discount,tax,shipping,total,payment_method)
       VALUES(?,?,?,?,?,?,?,?)`,
      [req.user.id, req.body.address_id || null, subtotal, discount, tax, shipping, total, req.body.payment_method || "mpesa"]
    );

    for (const item of items) {
      await conn.query(
        `INSERT INTO order_items(order_id,product_id,quantity,price) VALUES(?,?,?,?)`,
        [order.insertId, item.product_id, item.quantity, item.price]
      );

      await conn.query(
        `UPDATE products SET stock=stock-?, sold=sold+? WHERE id=?`,
        [item.quantity, item.quantity, item.product_id]
      );
    }

    await conn.query(`DELETE FROM carts WHERE user_id=?`, [req.user.id]);

    await conn.query(
      `INSERT INTO payments(order_id,method,amount,status) VALUES(?,?,?,'pending')`,
      [order.insertId, req.body.payment_method || "mpesa", total]
    );

    await conn.commit();

    io.emit("order_status", { orderId: order.insertId, status: "pending" });

    res.json({ message: "Order placed", orderId: order.insertId, total });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ error: e.message });
  } finally {
    conn.release();
  }
});

app.get("/api/orders", auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

app.get("/api/orders/:id/invoice", auth, async (req, res) => {
  const [[order]] = await pool.query(
    `SELECT * FROM orders WHERE id=? AND user_id=?`,
    [req.params.id, req.user.id]
  );

  if (!order) return res.status(404).send("Invoice not found");

  const [items] = await pool.query(
    `SELECT oi.*, p.name FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE order_id=?`,
    [order.id]
  );

  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Content-Disposition", `attachment; filename=invoice-${order.id}.txt`);
  res.send(
    `INVOICE #${order.id}\nTotal: KES ${order.total}\nStatus: ${order.status}\n\n` +
    items.map(i => `${i.name} x ${i.quantity} @ ${i.price}`).join("\n")
  );
});

/* REVIEWS */

app.post("/api/reviews", auth, async (req, res) => {
  await pool.query(
    `INSERT INTO reviews(user_id,product_id,rating,comment) VALUES(?,?,?,?)`,
    [req.user.id, req.body.product_id, req.body.rating, req.body.comment]
  );
  res.json({ message: "Review saved" });
});

/* ADMIN */

app.post("/api/admin/products", auth, adminOnly, async (req, res) => {
  const { category_id, name, description, price, stock, image, discount } = req.body;

  const [r] = await pool.query(
    `INSERT INTO products(category_id,name,description,price,stock,image,discount)
     VALUES(?,?,?,?,?,?,?)`,
    [category_id || null, name, description, price, stock, image, discount || 0]
  );

  await log(req.user.id, "PRODUCT_CREATED", name);
  res.json({ id: r.insertId });
});

app.put("/api/admin/products/:id", auth, adminOnly, async (req, res) => {
  const { category_id, name, description, price, stock, image, discount, status } = req.body;

  await pool.query(
    `UPDATE products SET category_id=?,name=?,description=?,price=?,stock=?,image=?,discount=?,status=? WHERE id=?`,
    [category_id, name, description, price, stock, image, discount || 0, status || "active", req.params.id]
  );

  await log(req.user.id, "PRODUCT_UPDATED", name);
  res.json({ message: "Product updated" });
});

app.delete("/api/admin/products/:id", auth, adminOnly, async (req, res) => {
  await pool.query(`UPDATE products SET status='deleted' WHERE id=?`, [req.params.id]);
  res.json({ message: "Product deleted" });
});

app.get("/api/admin/orders", auth, adminOnly, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT o.*, u.name customer_name, u.email customer_email
     FROM orders o JOIN users u ON u.id=o.user_id
     ORDER BY o.created_at DESC`
  );
  res.json(rows);
});

app.patch("/api/admin/orders/:id/status", auth, adminOnly, async (req, res) => {
  await pool.query(`UPDATE orders SET status=? WHERE id=?`, [req.body.status, req.params.id]);
  await log(req.user.id, "ORDER_STATUS_UPDATED", `${req.params.id}: ${req.body.status}`);

  io.emit("order_status", { orderId: req.params.id, status: req.body.status });

  res.json({ message: "Order updated" });
});

app.get("/api/admin/users", auth, adminOnly, async (req, res) => {
  const [rows] = await pool.query(`SELECT id,name,email,role,status,created_at FROM users ORDER BY created_at DESC`);
  res.json(rows);
});

app.patch("/api/admin/users/:id/status", auth, adminOnly, async (req, res) => {
  await pool.query(`UPDATE users SET status=? WHERE id=?`, [req.body.status, req.params.id]);
  res.json({ message: "User status updated" });
});

app.post("/api/admin/coupons", auth, adminOnly, async (req, res) => {
  await pool.query(
    `INSERT INTO coupons(code,type,value,active) VALUES(?,?,?,?)`,
    [req.body.code, req.body.type, req.body.value, req.body.active !== false]
  );
  res.json({ message: "Coupon created" });
});

app.get("/api/admin/analytics", auth, adminOnly, async (req, res) => {
  const [[revenue]] = await pool.query(`SELECT COALESCE(SUM(total),0) total FROM orders WHERE status!='cancelled'`);
  const [[orders]] = await pool.query(`SELECT COUNT(*) total FROM orders`);
  const [[customers]] = await pool.query(`SELECT COUNT(*) total FROM users WHERE role='customer'`);
  const [lowStock] = await pool.query(`SELECT * FROM products WHERE stock <= 10 AND status='active'`);
  const [best] = await pool.query(`SELECT name,sold FROM products ORDER BY sold DESC LIMIT 10`);
  const [daily] = await pool.query(
    `SELECT DATE(created_at) day, SUM(total) revenue FROM orders GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 30`
  );

  res.json({ revenue, orders, customers, lowStock, best, daily });
});

app.get("/api/admin/logs", auth, adminOnly, async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 300`);
  res.json(rows);
});

/* SUPER ADMIN */

app.post("/api/super/admins", auth, superOnly, async (req, res) => {
  const hash = await bcrypt.hash(req.body.password, 12);
  await pool.query(
    `INSERT INTO users(name,email,password_hash,role,email_verified) VALUES(?,?,?,?,1)`,
    [req.body.name, req.body.email, hash, req.body.role || "admin"]
  );
  res.json({ message: "Admin created" });
});

app.post("/api/super/settings", auth, superOnly, async (req, res) => {
  await pool.query(
    `INSERT INTO site_settings(setting_key,setting_value)
     VALUES(?,?)
     ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`,
    [req.body.key, req.body.value]
  );
  res.json({ message: "Setting saved" });
});

/* PAYMENTS */

app.post("/api/payments/mpesa/stk", auth, async (req, res) => {
  res.json({
    message: "M-Pesa STK Push endpoint ready",
    order_id: req.body.order_id,
    phone: req.body.phone,
    note: "Add Daraja live credentials in environment variables."
  });
});

app.post("/api/payments/mpesa/callback", async (req, res) => {
  await pool.query(
    `INSERT INTO activity_logs(action,details) VALUES('MPESA_CALLBACK',?)`,
    [JSON.stringify(req.body)]
  );
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

io.on("connection", socket => {
  console.log("Socket connected");
});

initDatabase().then(() => {
  server.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
});
