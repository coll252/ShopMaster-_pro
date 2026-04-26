require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret_key_now";
const CLIENT_URL = process.env.CLIENT_URL || "*";

app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    origin: CLIENT_URL === "*" ? "*" : CLIENT_URL,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { success: false, message: "Too many requests. Try again later." },
  })
);

let db;

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
    ssl:
      process.env.DB_SSL === "true"
        ? { rejectUnauthorized: false }
        : undefined,
  });

  await db.query("SELECT 1");
  console.log("✅ MySQL connected");

  await createTables();
  await seedDatabase();
}

async function createTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(160) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role ENUM('admin','manager','customer') DEFAULT 'admin',
      avatar TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      email VARCHAR(160),
      phone VARCHAR(60),
      avatar TEXT,
      address TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_code VARCHAR(30) NOT NULL UNIQUE,
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
      invoice_code VARCHAR(40) UNIQUE,
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
      status ENUM('active','expired') DEFAULT 'active'
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
      recipient VARCHAR(160) NOT NULL,
      subject VARCHAR(200) NOT NULL,
      body TEXT NOT NULL,
      status ENUM('draft','sent') DEFAULT 'draft',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("✅ Tables ready");
}

async function seedDatabase() {
  const [users] = await db.query("SELECT COUNT(*) AS total FROM users");
  if (users[0].total === 0) {
    const password = await bcrypt.hash("admin123", 10);

    await db.query(
      `
      INSERT INTO users (name,email,password,role,avatar)
      VALUES (?,?,?,?,?)
    `,
      [
        "Jubed Admin",
        "admin@ecommerce.com",
        password,
        "admin",
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop",
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
      INSERT INTO orders (order_code, customer_id, product_id, quantity, total, status, order_date)
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
      INSERT INTO traffic_sources (source_name, visitors, percentage)
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

  console.log("✅ Seed data ready");
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized. Login required.",
    });
  }

  try {
    const token = header.split(" ")[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access only.",
    });
  }

  next();
}

function safeText(value) {
  if (!value) return "";
  return String(value).trim();
}

function generateOrderCode() {
  return "#" + crypto.randomInt(100000, 999999);
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "E-commerce backend is running",
    routes: [
      "/api/auth/login",
      "/api/dashboard",
      "/api/products",
      "/api/orders",
      "/api/customers",
      "/api/traffic",
      "/api/sales-report",
      "/api/invoices",
      "/api/discounts",
      "/api/chats",
      "/api/emails",
    ],
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
      return res.status(400).json({
        success: false,
        message: "Name, valid email and password of 6+ characters required.",
      });
    }

    const [exists] = await db.query("SELECT id FROM users WHERE email=?", [email]);

    if (exists.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Email already exists.",
      });
    }

    const hash = await bcrypt.hash(password, 10);

    await db.query(
      "INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)",
      [name, email, hash, "admin"]
    );

    res.status(201).json({
      success: true,
      message: "User registered successfully.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Registration failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = safeText(req.body.email).toLowerCase();
    const password = safeText(req.body.password);

    const [rows] = await db.query("SELECT * FROM users WHERE email=?", [email]);

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid login details.",
      });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(401).json({
        success: false,
        message: "Invalid login details.",
      });
    }

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
      },
    });
  } catch {
    res.status(500).json({ success: false, message: "Login failed." });
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const [[ordersTotal]] = await db.query(`
      SELECT COUNT(*) AS totalOrders, COALESCE(SUM(total),0) AS totalSales
      FROM orders
    `);

    const [[today]] = await db.query(`
      SELECT COALESCE(SUM(total),0) AS todaySale
      FROM orders
      WHERE order_date = CURDATE()
    `);

    const [recentCustomers] = await db.query(`
      SELECT 
        orders.id,
        orders.order_code,
        orders.total,
        orders.status,
        orders.order_date,
        customers.name AS customer_name,
        products.image AS product_image
      FROM orders
      LEFT JOIN customers ON customers.id = orders.customer_id
      LEFT JOIN products ON products.id = orders.product_id
      ORDER BY orders.id DESC
      LIMIT 5
    `);

    res.json({
      success: true,
      stats: {
        todaySale: Number(today.todaySale) || 12426,
        totalSales: Number(ordersTotal.totalSales),
        totalOrders: Number(ordersTotal.totalOrders),
        todayGrowth: 36,
        totalSalesGrowth: -14,
        ordersGrowth: 36,
      },
      recentCustomers,
    });
  } catch {
    res.status(500).json({
      success: false,
      message: "Failed to load dashboard.",
    });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM products ORDER BY id DESC");
    res.json({ success: true, products: rows });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch products." });
  }
});

app.post("/api/products", auth, async (req, res) => {
  try {
    const name = safeText(req.body.name);
    const category = safeText(req.body.category);
    const price = Number(req.body.price);
    const stock = Number(req.body.stock);
    const image = safeText(req.body.image);
    const description = safeText(req.body.description);

    if (!name || !category || price < 0 || stock < 0) {
      return res.status(400).json({
        success: false,
        message: "Valid product name, category, price and stock required.",
      });
    }

    const [result] = await db.query(
      `
      INSERT INTO products (name,category,price,stock,image,description)
      VALUES (?,?,?,?,?,?)
    `,
      [name, category, price, stock, image, description]
    );

    res.status(201).json({
      success: true,
      message: "Product created.",
      productId: result.insertId,
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to create product." });
  }
});

app.put("/api/products/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = safeText(req.body.name);
    const category = safeText(req.body.category);
    const price = Number(req.body.price);
    const stock = Number(req.body.stock);
    const image = safeText(req.body.image);
    const description = safeText(req.body.description);
    const status = safeText(req.body.status) || "active";

    await db.query(
      `
      UPDATE products
      SET name=?, category=?, price=?, stock=?, image=?, description=?, status=?
      WHERE id=?
    `,
      [name, category, price, stock, image, description, status, id]
    );

    res.json({ success: true, message: "Product updated." });
  } catch {
    res.status(500).json({ success: false, message: "Failed to update product." });
  }
});

app.delete("/api/products/:id", auth, adminOnly, async (req, res) => {
  try {
    await db.query("DELETE FROM products WHERE id=?", [Number(req.params.id)]);
    res.json({ success: true, message: "Product deleted." });
  } catch {
    res.status(500).json({ success: false, message: "Failed to delete product." });
  }
});

app.get("/api/customers", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM customers ORDER BY id DESC");
    res.json({ success: true, customers: rows });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch customers." });
  }
});

app.post("/api/customers", auth, async (req, res) => {
  try {
    const name = safeText(req.body.name);
    const email = safeText(req.body.email);
    const phone = safeText(req.body.phone);
    const avatar = safeText(req.body.avatar);
    const address = safeText(req.body.address);

    if (!name) {
      return res.status(400).json({ success: false, message: "Customer name required." });
    }

    const [result] = await db.query(
      `
      INSERT INTO customers (name,email,phone,avatar,address)
      VALUES (?,?,?,?,?)
    `,
      [name, email, phone, avatar, address]
    );

    res.status(201).json({
      success: true,
      message: "Customer created.",
      customerId: result.insertId,
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to create customer." });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        orders.*,
        customers.name AS customer_name,
        customers.email AS customer_email,
        products.name AS product_name,
        products.image AS product_image
      FROM orders
      LEFT JOIN customers ON customers.id = orders.customer_id
      LEFT JOIN products ON products.id = orders.product_id
      ORDER BY orders.id DESC
    `);

    res.json({ success: true, orders: rows });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch orders." });
  }
});

app.post("/api/orders", auth, async (req, res) => {
  try {
    const customerId = Number(req.body.customer_id);
    const productId = Number(req.body.product_id);
    const quantity = Number(req.body.quantity || 1);

    const [[product]] = await db.query("SELECT * FROM products WHERE id=?", [productId]);

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }

    if (product.stock < quantity) {
      return res.status(400).json({
        success: false,
        message: "Not enough product stock.",
      });
    }

    const total = Number(product.price) * quantity;
    const orderCode = generateOrderCode();

    const [result] = await db.query(
      `
      INSERT INTO orders (order_code,customer_id,product_id,quantity,total,status,order_date)
      VALUES (?,?,?,?,?,'Pending',CURDATE())
    `,
      [orderCode, customerId, productId, quantity, total]
    );

    await db.query("UPDATE products SET stock = stock - ? WHERE id=?", [
      quantity,
      productId,
    ]);

    res.status(201).json({
      success: true,
      message: "Order created.",
      orderId: result.insertId,
      orderCode,
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to create order." });
  }
});

app.put("/api/orders/:id/status", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = safeText(req.body.status);

    const allowed = ["Complete", "Pending", "Cancelled", "Refunded"];

    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status." });
    }

    await db.query("UPDATE orders SET status=? WHERE id=?", [status, id]);

    res.json({ success: true, message: "Order status updated." });
  } catch {
    res.status(500).json({ success: false, message: "Failed to update order." });
  }
});

app.get("/api/traffic", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM traffic_sources ORDER BY visitors DESC");
    res.json({ success: true, traffic: rows });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch traffic." });
  }
});

app.get("/api/sales-report", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM sales_reports ORDER BY id ASC");
    res.json({ success: true, salesReport: rows });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch sales report." });
  }
});

app.get("/api/invoices", auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT invoices.*, orders.order_code
      FROM invoices
      LEFT JOIN orders ON orders.id = invoices.order_id
      ORDER BY invoices.id DESC
    `);

    res.json({ success: true, invoices: rows });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch invoices." });
  }
});

app.post("/api/invoices", auth, async (req, res) => {
  try {
    const orderId = Number(req.body.order_id);
    const [[order]] = await db.query("SELECT * FROM orders WHERE id=?", [orderId]);

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    const invoiceCode = "INV-" + crypto.randomInt(100000, 999999);

    await db.query(
      `
      INSERT INTO invoices (invoice_code,order_id,amount,status)
      VALUES (?,?,?,'paid')
    `,
      [invoiceCode, orderId, order.total]
    );

    res.status(201).json({
      success: true,
      message: "Invoice created.",
      invoiceCode,
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to create invoice." });
  }
});

app.get("/api/discounts", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM discounts ORDER BY id DESC");
    res.json({ success: true, discounts: rows });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch discounts." });
  }
});

app.post("/api/discounts", auth, adminOnly, async (req, res) => {
  try {
    const code = safeText(req.body.code).toUpperCase();
    const percentage = Number(req.body.percentage);
    const expiresAt = req.body.expires_at || null;

    if (!code || percentage <= 0 || percentage > 100) {
      return res.status(400).json({
        success: false,
        message: "Valid discount code and percentage required.",
      });
    }

    await db.query(
      `
      INSERT INTO discounts (code,percentage,expires_at,status)
      VALUES (?,?,?,'active')
    `,
      [code, percentage, expiresAt]
    );

    res.status(201).json({ success: true, message: "Discount created." });
  } catch {
    res.status(500).json({ success: false, message: "Failed to create discount." });
  }
});

app.get("/api/chats", auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT chats.*, customers.name AS customer_name
      FROM chats
      LEFT JOIN customers ON customers.id = chats.customer_id
      ORDER BY chats.id DESC
    `);

    res.json({ success: true, chats: rows });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch chats." });
  }
});

app.post("/api/chats", async (req, res) => {
  try {
    const customerId = Number(req.body.customer_id || 0) || null;
    const message = safeText(req.body.message);
    const sender = safeText(req.body.sender) || "customer";

    if (!message) {
      return res.status(400).json({ success: false, message: "Message required." });
    }

    await db.query(
      `
      INSERT INTO chats (customer_id,message,sender)
      VALUES (?,?,?)
    `,
      [customerId, message, sender]
    );

    res.status(201).json({ success: true, message: "Chat message saved." });
  } catch {
    res.status(500).json({ success: false, message: "Failed to save chat." });
  }
});

app.get("/api/emails", auth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM emails ORDER BY id DESC");
    res.json({ success: true, emails: rows });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch emails." });
  }
});

app.post("/api/emails", auth, async (req, res) => {
  try {
    const recipient = safeText(req.body.recipient);
    const subject = safeText(req.body.subject);
    const body = safeText(req.body.body);
    const status = safeText(req.body.status) || "draft";

    if (!recipient || !subject || !body) {
      return res.status(400).json({
        success: false,
        message: "Recipient, subject and body required.",
      });
    }

    await db.query(
      `
      INSERT INTO emails (recipient,subject,body,status)
      VALUES (?,?,?,?)
    `,
      [recipient, subject, body, status]
    );

    res.status(201).json({
      success: true,
      message: status === "sent" ? "Email saved as sent." : "Email draft saved.",
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to save email." });
  }
});

app.get("/api/search", async (req, res) => {
  try {
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

    res.json({
      success: true,
      results: [...products, ...customers, ...orders],
    });
  } catch {
    res.status(500).json({ success: false, message: "Search failed." });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found.",
  });
});

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    success: false,
    message: "Server error.",
  });
});

connectDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("❌ Failed to start server:", error.message);
    process.exit(1);
  });
