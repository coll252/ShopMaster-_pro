require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const axios = require("axios");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret";
const CLIENT_URL = process.env.CLIENT_URL || "*";
const APP_URL = process.env.APP_URL || "http://localhost:5000";
const API_URL = process.env.API_URL || `http://localhost:${PORT}`;

let db;

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(cors({
  origin: CLIENT_URL === "*" ? "*" : CLIENT_URL,
  credentials: true
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { success: false, message: "Too many requests. Try again later." }
}));

app.use(express.static(path.join(__dirname, "public")));

const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

async function sendMail(to, subject, html) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.log("Email skipped: Gmail credentials missing.");
    return;
  }

  await mailer.sendMail({
    from: `"E-commerce Dashboard" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html
  });
}

async function connectDatabase() {
  db = await mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });

  await db.query("SELECT 1");
  console.log("MySQL connected");

  await createTables();
  await seedDatabase();
}

async function createTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(180) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role ENUM('admin','manager','customer') DEFAULT 'customer',
      avatar TEXT,
      is_verified BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS email_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token VARCHAR(255) NOT NULL UNIQUE,
      type ENUM('verify','reset') NOT NULL,
      expires_at DATETIME NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      category VARCHAR(100) NOT NULL,
      price DECIMAL(12,2) NOT NULL DEFAULT 0,
      stock INT NOT NULL DEFAULT 0,
      image TEXT,
      description TEXT,
      status ENUM('active','inactive') DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      email VARCHAR(180),
      phone VARCHAR(60),
      avatar TEXT,
      address TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_code VARCHAR(40) NOT NULL UNIQUE,
      customer_id INT,
      product_id INT,
      quantity INT NOT NULL DEFAULT 1,
      total DECIMAL(12,2) NOT NULL DEFAULT 0,
      status ENUM('Complete','Pending','Cancelled','Refunded') DEFAULT 'Pending',
      order_date DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS traffic_sources (
      id INT AUTO_INCREMENT PRIMARY KEY,
      source_name VARCHAR(100) NOT NULL,
      visitors INT NOT NULL DEFAULT 0,
      percentage INT NOT NULL DEFAULT 0
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sales_reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      month_name VARCHAR(20) NOT NULL,
      revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
      orders_count INT NOT NULL DEFAULT 0
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_code VARCHAR(50) UNIQUE,
      order_id INT,
      amount DECIMAL(12,2),
      status ENUM('paid','unpaid','overdue') DEFAULT 'unpaid',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS discounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) UNIQUE,
      percentage INT NOT NULL,
      expires_at DATE,
      status ENUM('active','expired') DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS chats (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customer_id INT,
      message TEXT NOT NULL,
      sender ENUM('customer','admin') DEFAULT 'customer',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS emails (
      id INT AUTO_INCREMENT PRIMARY KEY,
      recipient VARCHAR(180) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      status ENUM('draft','sent') DEFAULT 'draft',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS mpesa_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      phone VARCHAR(30) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      merchant_request_id VARCHAR(120),
      checkout_request_id VARCHAR(120),
      mpesa_receipt VARCHAR(120),
      result_code INT,
      result_desc TEXT,
      status ENUM('pending','success','failed') DEFAULT 'pending',
      raw_callback JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("Tables ready");
}

async function seedDatabase() {
  const [users] = await db.query("SELECT COUNT(*) AS total FROM users");
  if (users[0].total === 0) {
    const password = await bcrypt.hash("admin123", 10);

    await db.query(
      `INSERT INTO users (name,email,password,role,is_verified,avatar)
       VALUES (?,?,?,?,?,?)`,
      [
        "Jubed Admin",
        "admin@ecommerce.com",
        password,
        "admin",
        true,
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop"
      ]
    );
  }

  const [products] = await db.query("SELECT COUNT(*) AS total FROM products");
  if (products[0].total === 0) {
    await db.query(`
      INSERT INTO products (name,category,price,stock,image,description)
      VALUES
      ('iPhone 15 Pro','Mobile',1250,42,'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=80&h=80&fit=crop','Premium smartphone'),
      ('MacBook Pro','Laptop',2400,18,'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=80&h=80&fit=crop','Powerful laptop'),
      ('Smart Watch','Watch',320,91,'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=80&h=80&fit=crop','Modern smart watch'),
      ('Headphones','Accessories',180,77,'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=80&h=80&fit=crop','Wireless headphones')
    `);
  }

  const [customers] = await db.query("SELECT COUNT(*) AS total FROM customers");
  if (customers[0].total === 0) {
    await db.query(`
      INSERT INTO customers (name,email,phone,avatar,address)
      VALUES
      ('Ripon Ahmed','ripon@email.com','0700000001','https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=80&h=80&fit=crop','Nairobi'),
      ('Leslie Alexander','leslie@email.com','0700000002','https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=80&h=80&fit=crop','Mombasa'),
      ('Ralph Edwards','ralph@email.com','0700000003','https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=80&h=80&fit=crop','Kisumu'),
      ('Ronald Richards','ronald@email.com','0700000004','https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=80&h=80&fit=crop','Nakuru'),
      ('Devon Lane','devon@email.com','0700000005','https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=80&h=80&fit=crop','Eldoret')
    `);
  }

  const [orders] = await db.query("SELECT COUNT(*) AS total FROM orders");
  if (orders[0].total === 0) {
    await db.query(`
      INSERT INTO orders (order_code,customer_id,product_id,quantity,total,status,order_date)
      VALUES
      ('#202395',1,1,1,20584,'Complete','2024-01-01'),
      ('#202396',2,2,1,11234,'Pending','2024-01-02'),
      ('#202397',3,3,2,11159,'Complete','2024-01-03'),
      ('#202398',4,4,3,10483,'Complete','2024-01-04'),
      ('#202399',5,1,1,9084,'Pending','2024-01-06')
    `);
  }

  const [traffic] = await db.query("SELECT COUNT(*) AS total FROM traffic_sources");
  if (traffic[0].total === 0) {
    await db.query(`
      INSERT INTO traffic_sources (source_name,visitors,percentage)
      VALUES
      ('Direct',143382,95),
      ('Referral',87974,75),
      ('Social Media',45211,38),
      ('Twitter',21893,18),
      ('Facebook',21893,18)
    `);
  }

  const [sales] = await db.query("SELECT COUNT(*) AS total FROM sales_reports");
  if (sales[0].total === 0) {
    await db.query(`
      INSERT INTO sales_reports (month_name,revenue,orders_count)
      VALUES
      ('Feb',20000,15000),
      ('Mar',25000,18000),
      ('Apr',28000,20000),
      ('May',42000,25000),
      ('Jun',40000,24000),
      ('Jul',48000,30000),
      ('Aug',55000,34000),
      ('Sep',60000,32000),
      ('Oct',72000,38000),
      ('Nov',70000,35000),
      ('Dec',78000,43000),
      ('Jan',90000,40000)
    `);
  }

  console.log("Seed data ready");
}

function safeText(value) {
  return value ? String(value).trim() : "";
}

function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Login required." });
  }

  try {
    req.user = jwt.verify(header.split(" ")[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin only." });
  }

  next();
}

function generateCode(prefix = "#") {
  return prefix + crypto.randomInt(100000, 999999);
}

function mpesaBaseUrl() {
  return process.env.MPESA_ENV === "live"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

function formatPhone(phone) {
  let p = String(phone).replace(/\D/g, "");
  if (p.startsWith("0")) p = "254" + p.slice(1);
  if (p.startsWith("7")) p = "254" + p;
  if (p.startsWith("1")) p = "254" + p;
  return p;
}

function mpesaTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

async function getMpesaToken() {
  const authCode = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString("base64");

  const response = await axios.get(
    `${mpesaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${authCode}` } }
  );

  return response.data.access_token;
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "E-commerce backend running",
    defaultAdmin: "admin@ecommerce.com"
  });
});

app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ success: true, database: "connected" });
  } catch {
    res.status(500).json({ success: false, database: "failed" });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const name = safeText(req.body.name);
    const email = safeText(req.body.email).toLowerCase();
    const password = safeText(req.body.password);

    if (!name || !email || password.length < 6) {
      return res.status(400).json({ success: false, message: "Name, email and 6+ character password required." });
    }

    const [exists] = await db.query("SELECT id FROM users WHERE email=?", [email]);
    if (exists.length) {
      return res.status(409).json({ success: false, message: "Email already exists." });
    }

    const hash = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      "INSERT INTO users (name,email,password,role,is_verified) VALUES (?,?,?,?,?)",
      [name, email, hash, "customer", false]
    );

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24);

    await db.query(
      "INSERT INTO email_tokens (user_id,token,type,expires_at) VALUES (?,?,?,?)",
      [result.insertId, token, "verify", expires]
    );

    const link = `${API_URL}/api/auth/verify-email/${token}`;

    await sendMail(email, "Confirm your email", `
      <h2>Welcome, ${name}</h2>
      <p>Click below to verify your account.</p>
      <a href="${link}" style="background:#2f80ed;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;">Verify Email</a>
      <p>${link}</p>
    `);

    res.status(201).json({ success: true, message: "Account created. Verification link sent." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Registration failed." });
  }
});

app.get("/api/auth/verify-email/:token", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM email_tokens WHERE token=? AND type='verify' AND used=FALSE AND expires_at > NOW()",
      [req.params.token]
    );

    if (!rows.length) return res.status(400).send("Invalid or expired verification link.");

    await db.query("UPDATE users SET is_verified=TRUE WHERE id=?", [rows[0].user_id]);
    await db.query("UPDATE email_tokens SET used=TRUE WHERE id=?", [rows[0].id]);

    res.send(`<h2>Email verified successfully.</h2><a href="${APP_URL}">Go to login</a>`);
  } catch {
    res.status(500).send("Verification failed.");
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = safeText(req.body.email).toLowerCase();
    const password = safeText(req.body.password);

    const [rows] = await db.query("SELECT * FROM users WHERE email=?", [email]);
    if (!rows.length) return res.status(401).json({ success: false, message: "Invalid login details." });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);

    if (!valid) return res.status(401).json({ success: false, message: "Invalid login details." });

    const token = createToken(user);

    res.json({
      success: true,
      message: "Login successful.",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        is_verified: user.is_verified
      }
    });
  } catch {
    res.status(500).json({ success: false, message: "Login failed." });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const email = safeText(req.body.email).toLowerCase();
    const [users] = await db.query("SELECT * FROM users WHERE email=?", [email]);

    if (!users.length) {
      return res.json({ success: true, message: "If email exists, reset link has been sent." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 1000 * 60 * 30);

    await db.query(
      "INSERT INTO email_tokens (user_id,token,type,expires_at) VALUES (?,?,?,?)",
      [users[0].id, token, "reset", expires]
    );

    const link = `${APP_URL}?reset=${token}`;

    await sendMail(email, "Password reset link", `
      <h2>Password Reset</h2>
      <p>Click below to reset your password.</p>
      <a href="${link}" style="background:#2f80ed;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;">Reset Password</a>
      <p>${link}</p>
    `);

    res.json({ success: true, message: "If email exists, reset link has been sent." });
  } catch {
    res.status(500).json({ success: false, message: "Failed to send reset link." });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const token = safeText(req.body.token);
    const password = safeText(req.body.password);

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be 6+ characters." });
    }

    const [rows] = await db.query(
      "SELECT * FROM email_tokens WHERE token=? AND type='reset' AND used=FALSE AND expires_at > NOW()",
      [token]
    );

    if (!rows.length) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset token." });
    }

    const hash = await bcrypt.hash(password, 10);

    await db.query("UPDATE users SET password=? WHERE id=?", [hash, rows[0].user_id]);
    await db.query("UPDATE email_tokens SET used=TRUE WHERE id=?", [rows[0].id]);

    res.json({ success: true, message: "Password reset successful." });
  } catch {
    res.status(500).json({ success: false, message: "Password reset failed." });
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const [[summary]] = await db.query(`
      SELECT COUNT(*) AS totalOrders, COALESCE(SUM(total),0) AS totalSales FROM orders
    `);

    const [[today]] = await db.query(`
      SELECT COALESCE(SUM(total),0) AS todaySale FROM orders WHERE order_date = CURDATE()
    `);

    const [recentCustomers] = await db.query(`
      SELECT orders.*, customers.name AS customer_name, products.image AS product_image
      FROM orders
      LEFT JOIN customers ON customers.id=orders.customer_id
      LEFT JOIN products ON products.id=orders.product_id
      ORDER BY orders.id DESC LIMIT 5
    `);

    res.json({
      success: true,
      stats: {
        todaySale: Number(today.todaySale) || 12426,
        totalSales: Number(summary.totalSales),
        totalOrders: Number(summary.totalOrders),
        todayGrowth: 36,
        totalSalesGrowth: -14,
        ordersGrowth: 36
      },
      recentCustomers
    });
  } catch {
    res.status(500).json({ success: false, message: "Dashboard failed." });
  }
});

app.get("/api/products", async (req, res) => {
  const [rows] = await db.query("SELECT * FROM products ORDER BY id DESC");
  res.json({ success: true, products: rows });
});

app.post("/api/products", auth, async (req, res) => {
  try {
    const { name, category, price, stock, image, description } = req.body;

    const [result] = await db.query(
      "INSERT INTO products (name,category,price,stock,image,description) VALUES (?,?,?,?,?,?)",
      [safeText(name), safeText(category), Number(price), Number(stock), safeText(image), safeText(description)]
    );

    res.status(201).json({ success: true, message: "Product created.", id: result.insertId });
  } catch {
    res.status(500).json({ success: false, message: "Product creation failed." });
  }
});

app.get("/api/orders", async (req, res) => {
  const [rows] = await db.query(`
    SELECT orders.*, customers.name AS customer_name, products.name AS product_name, products.image AS product_image
    FROM orders
    LEFT JOIN customers ON customers.id=orders.customer_id
    LEFT JOIN products ON products.id=orders.product_id
    ORDER BY orders.id DESC
  `);

  res.json({ success: true, orders: rows });
});

app.post("/api/orders", auth, async (req, res) => {
  try {
    const customerId = Number(req.body.customer_id);
    const productId = Number(req.body.product_id);
    const quantity = Number(req.body.quantity || 1);

    const [[product]] = await db.query("SELECT * FROM products WHERE id=?", [productId]);
    if (!product) return res.status(404).json({ success: false, message: "Product not found." });

    if (product.stock < quantity) {
      return res.status(400).json({ success: false, message: "Insufficient stock." });
    }

    const total = Number(product.price) * quantity;
    const orderCode = generateCode("#");

    const [result] = await db.query(
      "INSERT INTO orders (order_code,customer_id,product_id,quantity,total,status,order_date) VALUES (?,?,?,?,?,'Pending',CURDATE())",
      [orderCode, customerId, productId, quantity, total]
    );

    await db.query("UPDATE products SET stock=stock-? WHERE id=?", [quantity, productId]);

    res.status(201).json({ success: true, message: "Order created.", id: result.insertId, orderCode });
  } catch {
    res.status(500).json({ success: false, message: "Order creation failed." });
  }
});

app.get("/api/customers", async (req, res) => {
  const [rows] = await db.query("SELECT * FROM customers ORDER BY id DESC");
  res.json({ success: true, customers: rows });
});

app.post("/api/customers", auth, async (req, res) => {
  const { name, email, phone, avatar, address } = req.body;

  const [result] = await db.query(
    "INSERT INTO customers (name,email,phone,avatar,address) VALUES (?,?,?,?,?)",
    [safeText(name), safeText(email), safeText(phone), safeText(avatar), safeText(address)]
  );

  res.status(201).json({ success: true, message: "Customer created.", id: result.insertId });
});

app.get("/api/traffic", async (req, res) => {
  const [rows] = await db.query("SELECT * FROM traffic_sources ORDER BY visitors DESC");
  res.json({ success: true, traffic: rows });
});

app.get("/api/sales-report", async (req, res) => {
  const [rows] = await db.query("SELECT * FROM sales_reports ORDER BY id ASC");
  res.json({ success: true, salesReport: rows });
});

app.get("/api/discounts", async (req, res) => {
  const [rows] = await db.query("SELECT * FROM discounts ORDER BY id DESC");
  res.json({ success: true, discounts: rows });
});

app.post("/api/discounts", auth, adminOnly, async (req, res) => {
  const code = safeText(req.body.code).toUpperCase();
  const percentage = Number(req.body.percentage);
  const expiresAt = req.body.expires_at || null;

  await db.query(
    "INSERT INTO discounts (code,percentage,expires_at,status) VALUES (?,?,?,'active')",
    [code, percentage, expiresAt]
  );

  res.status(201).json({ success: true, message: "Discount created." });
});

app.get("/api/invoices", auth, async (req, res) => {
  const [rows] = await db.query(`
    SELECT invoices.*, orders.order_code
    FROM invoices
    LEFT JOIN orders ON orders.id=invoices.order_id
    ORDER BY invoices.id DESC
  `);

  res.json({ success: true, invoices: rows });
});

app.post("/api/invoices", auth, async (req, res) => {
  const orderId = Number(req.body.order_id);
  const [[order]] = await db.query("SELECT * FROM orders WHERE id=?", [orderId]);

  if (!order) return res.status(404).json({ success: false, message: "Order not found." });

  const code = generateCode("INV-");

  await db.query(
    "INSERT INTO invoices (invoice_code,order_id,amount,status) VALUES (?,?,?,'paid')",
    [code, orderId, order.total]
  );

  res.status(201).json({ success: true, message: "Invoice created.", invoiceCode: code });
});

app.get("/api/chats", auth, async (req, res) => {
  const [rows] = await db.query(`
    SELECT chats.*, customers.name AS customer_name
    FROM chats
    LEFT JOIN customers ON customers.id=chats.customer_id
    ORDER BY chats.id DESC
  `);

  res.json({ success: true, chats: rows });
});

app.post("/api/chats", async (req, res) => {
  await db.query(
    "INSERT INTO chats (customer_id,message,sender) VALUES (?,?,?)",
    [Number(req.body.customer_id) || null, safeText(req.body.message), safeText(req.body.sender) || "customer"]
  );

  res.status(201).json({ success: true, message: "Chat saved." });
});

app.post("/api/emails/send", auth, async (req, res) => {
  try {
    const recipient = safeText(req.body.recipient);
    const subject = safeText(req.body.subject);
    const body = safeText(req.body.body);

    await sendMail(recipient, subject, `<p>${body}</p>`);

    await db.query(
      "INSERT INTO emails (recipient,subject,body,status) VALUES (?,?,?,'sent')",
      [recipient, subject, body]
    );

    res.json({ success: true, message: "Email sent successfully." });
  } catch {
    res.status(500).json({ success: false, message: "Email sending failed." });
  }
});

app.post("/api/mpesa/stk-push", async (req, res) => {
  try {
    const phone = formatPhone(req.body.phone);
    const amount = Number(req.body.amount);

    if (!phone || amount <= 0) {
      return res.status(400).json({ success: false, message: "Valid phone and amount required." });
    }

    const token = await getMpesaToken();
    const timestamp = mpesaTimestamp();

    const password = Buffer.from(
      `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
    ).toString("base64");

    const payload = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: "ECOMMERCE",
      TransactionDesc: "E-commerce payment"
    };

    const response = await axios.post(
      `${mpesaBaseUrl()}/mpesa/stkpush/v1/processrequest`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    await db.query(
      `INSERT INTO mpesa_payments (phone,amount,merchant_request_id,checkout_request_id,status)
       VALUES (?,?,?,?,?)`,
      [
        phone,
        amount,
        response.data.MerchantRequestID,
        response.data.CheckoutRequestID,
        "pending"
      ]
    );

    res.json({
      success: true,
      message: "M-Pesa STK Push sent. Check your phone.",
      data: response.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "M-Pesa request failed.",
      error: error.response?.data || error.message
    });
  }
});

app.post("/api/mpesa/callback", async (req, res) => {
  try {
    const callback = req.body.Body?.stkCallback;
    if (!callback) return res.json({ ResultCode: 0, ResultDesc: "Received" });

    let receipt = null;

    if (callback.ResultCode === 0 && callback.CallbackMetadata?.Item) {
      const item = callback.CallbackMetadata.Item.find(x => x.Name === "MpesaReceiptNumber");
      receipt = item?.Value || null;
    }

    await db.query(
      `UPDATE mpesa_payments
       SET result_code=?, result_desc=?, mpesa_receipt=?, status=?, raw_callback=?
       WHERE checkout_request_id=?`,
      [
        callback.ResultCode,
        callback.ResultDesc,
        receipt,
        callback.ResultCode === 0 ? "success" : "failed",
        JSON.stringify(req.body),
        callback.CheckoutRequestID
      ]
    );

    res.json({ ResultCode: 0, ResultDesc: "Callback processed" });
  } catch {
    res.json({ ResultCode: 0, ResultDesc: "Callback received" });
  }
});

app.get("/api/mpesa/status/:checkoutRequestId", async (req, res) => {
  const [rows] = await db.query(
    "SELECT * FROM mpesa_payments WHERE checkout_request_id=?",
    [req.params.checkoutRequestId]
  );

  if (!rows.length) return res.status(404).json({ success: false, message: "Payment not found." });

  res.json({ success: true, payment: rows[0] });
});

app.get("/api/search", async (req, res) => {
  const q = `%${safeText(req.query.q)}%`;

  const [products] = await db.query(
    "SELECT id,name,category,price,'product' AS type FROM products WHERE name LIKE ? OR category LIKE ? LIMIT 10",
    [q, q]
  );

  const [customers] = await db.query(
    "SELECT id,name,email,'customer' AS type FROM customers WHERE name LIKE ? OR email LIKE ? LIMIT 10",
    [q, q]
  );

  const [orders] = await db.query(
    "SELECT id,order_code,total,status,'order' AS type FROM orders WHERE order_code LIKE ? LIMIT 10",
    [q]
  );

  res.json({ success: true, results: [...products, ...customers, ...orders] });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found." });
});

connectDatabase()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(error => {
    console.error("Server failed:", error.message);
    process.exit(1);
  });
