require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(
  helmet({
    contentSecurityPolicy: false
  })
);
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 5000;

let pool;

const dbConfig = {
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
      ? {
          rejectUnauthorized: false
        }
      : undefined
};

async function connectDB() {
  pool = mysql.createPool(dbConfig);
  await pool.query("SELECT 1");
  console.log("Connected to MySQL / Aiven");
}

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(180) UNIQUE NOT NULL,
      phone VARCHAR(40),
      password VARCHAR(255) NOT NULL,
      role ENUM('customer','admin','super_admin') DEFAULT 'customer',
      status ENUM('active','blocked') DEFAULT 'active',
      avatar TEXT,
      reset_token VARCHAR(255),
      reset_token_expiry DATETIME,
      last_login DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      category_id INT NULL,
      name VARCHAR(180) NOT NULL,
      sku VARCHAR(100),
      description TEXT,
      price DECIMAL(12,2) NOT NULL DEFAULT 0,
      discount DECIMAL(12,2) DEFAULT 0,
      stock INT DEFAULT 0,
      image TEXT,
      featured BOOLEAN DEFAULT FALSE,
      status ENUM('active','draft','archived') DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cart_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity INT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wishlist (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      product_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_wishlist (user_id, product_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_code VARCHAR(40) UNIQUE,
      user_id INT NULL,
      total DECIMAL(12,2) DEFAULT 0,
      shipping_fee DECIMAL(12,2) DEFAULT 0,
      tax DECIMAL(12,2) DEFAULT 0,
      discount DECIMAL(12,2) DEFAULT 0,
      payment_method VARCHAR(80),
      payment_status ENUM('pending','paid','failed','refunded') DEFAULT 'pending',
      order_status ENUM('pending','processing','packed','shipped','delivered','cancelled','returned') DEFAULT 'pending',
      address TEXT,
      phone VARCHAR(40),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      product_id INT NULL,
      product_name VARCHAR(180),
      quantity INT,
      price DECIMAL(12,2),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NULL,
      user_id INT NULL,
      method VARCHAR(80),
      amount DECIMAL(12,2),
      phone VARCHAR(40),
      transaction_code VARCHAR(150),
      status ENUM('pending','paid','failed','refunded') DEFAULT 'pending',
      raw_response JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS coupons (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(80) UNIQUE NOT NULL,
      discount_percent INT DEFAULT 0,
      active BOOLEAN DEFAULT TRUE,
      expires_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      product_id INT,
      rating INT,
      comment TEXT,
      status ENUM('pending','approved','rejected') DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT,
      invoice_code VARCHAR(80),
      amount DECIMAL(12,2),
      status ENUM('unpaid','paid','cancelled') DEFAULT 'unpaid',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      subject VARCHAR(180),
      message TEXT,
      status ENUM('open','replied','closed') DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      action VARCHAR(255),
      ip_address VARCHAR(80),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      setting_key VARCHAR(100) UNIQUE,
      setting_value TEXT
    )
  `);

  const [catCount] = await pool.query("SELECT COUNT(*) AS total FROM categories");
  if (catCount[0].total === 0) {
    await pool.query(`
      INSERT INTO categories (name, description) VALUES
      ('Electronics','Phones, laptops, accessories and gadgets'),
      ('Fashion','Clothes, shoes, watches and lifestyle items'),
      ('Home & Living','Furniture, kitchenware and home accessories'),
      ('Beauty','Beauty, health and personal care products')
    `);
  }

  const [productCount] = await pool.query("SELECT COUNT(*) AS total FROM products");
  if (productCount[0].total === 0) {
    await pool.query(`
      INSERT INTO products 
      (category_id,name,sku,description,price,discount,stock,image,featured,status)
      VALUES
      (1,'Smartphone Pro X','PHN-001','Premium smartphone with strong camera, fast charging and long battery life.',35000,2000,35,'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9',true,'active'),
      (1,'Wireless Headphones','AUD-002','Noise cancelling headphones with deep bass and long battery life.',4500,500,80,'https://images.unsplash.com/photo-1505740420928-5e560c06d30e',true,'active'),
      (2,'Classic Sneakers','SHO-003','Comfortable sneakers for daily wear and casual outfits.',3200,300,70,'https://images.unsplash.com/photo-1542291026-7eec264c27ff',true,'active'),
      (3,'Modern Office Chair','CHR-004','Ergonomic office chair for work, study and gaming setup.',6500,700,25,'https://images.unsplash.com/photo-1503602642458-232111445657',false,'active'),
      (2,'Luxury Watch','WAT-005','Elegant wrist watch for business and casual fashion.',5800,400,40,'https://images.unsplash.com/photo-1523275335684-37898b6baf30',true,'active'),
      (4,'Beauty Skin Kit','BTY-006','Complete skincare kit for daily facial care routine.',2800,200,60,'https://images.unsplash.com/photo-1596462502278-27bfdc403348',false,'active')
    `);
  }

  const [adminCount] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role IN ('admin','super_admin')");

  if (adminCount[0].total === 0) {
    const adminEmail = process.env.ADMIN_EMAIL || "admin@shopmaster.com";
    const adminPassword = process.env.ADMIN_PASSWORD || "Admin12345";
    const adminName = process.env.ADMIN_NAME || "Main Admin";
    const adminPhone = process.env.ADMIN_PHONE || "254700000000";

    const hashed = await bcrypt.hash(adminPassword, 12);

    await pool.query(
      `
      INSERT INTO users (name,email,phone,password,role,status)
      VALUES (?,?,?,?,?,?)
      `,
      [adminName, adminEmail, adminPhone, hashed, "super_admin", "active"]
    );

    console.log("Super admin created from .env");
  }

  console.log("Database tables ready");
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    process.env.JWT_SECRET || "fallback_secret_change_me",
    { expiresIn: "7d" }
  );
}

function auth(roles = []) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization;
      if (!header) return res.status(401).json({ message: "Login required" });

      const token = header.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "fallback_secret_change_me");

      const [rows] = await pool.query("SELECT id, email, role, status FROM users WHERE id=?", [
        decoded.id
      ]);

      const user = rows[0];

      if (!user) return res.status(401).json({ message: "User no longer exists" });
      if (user.status !== "active") return res.status(403).json({ message: "Account blocked" });

      if (roles.length && !roles.includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }

      req.user = user;
      next();
    } catch {
      res.status(401).json({ message: "Invalid or expired token" });
    }
  };
}

async function logAction(userId, action, req) {
  try {
    await pool.query(
      "INSERT INTO activity_logs (user_id, action, ip_address) VALUES (?,?,?)",
      [userId || null, action, req?.ip || ""]
    );
  } catch {}
}

function makeOrderCode() {
  return "ORD-" + Date.now() + "-" + Math.floor(Math.random() * 9999);
}

function makeInvoiceCode() {
  return "INV-" + Date.now() + "-" + Math.floor(Math.random() * 9999);
}

function mailerReady() {
  return Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

async function sendEmail(to, subject, html) {
  if (!mailerReady()) {
    console.log("Email skipped. Configure EMAIL_USER and EMAIL_PASS.");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: Number(process.env.EMAIL_PORT || 587),
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  await transporter.sendMail({
    from: `"ShopMaster Pro" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html
  });
}

/* ========================= AUTH ========================= */

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required" });
    }

    const hashed = await bcrypt.hash(password, 12);

    await pool.query(
      "INSERT INTO users (name,email,phone,password,role,status) VALUES (?,?,?,?,?,?)",
      [name, email, phone || "", hashed, "customer", "active"]
    );

    await sendEmail(
      email,
      "Welcome to ShopMaster Pro",
      `<h2>Welcome ${name}</h2><p>Your customer account has been created successfully.</p>`
    );

    res.json({ message: "Account created successfully. You can login now." });
  } catch (err) {
    res.status(500).json({ message: "Registration failed", error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const [rows] = await pool.query("SELECT * FROM users WHERE email=?", [email]);
    const user = rows[0];

    if (!user) return res.status(404).json({ message: "Account not found" });
    if (user.status !== "active") return res.status(403).json({ message: "Account blocked" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: "Invalid password" });

    await pool.query("UPDATE users SET last_login=NOW() WHERE id=?", [user.id]);

    const token = createToken(user);

    await logAction(user.id, `${user.role} logged in`, req);

    await sendEmail(
      user.email,
      "Login Notification",
      `<h3>Login Notification</h3><p>Your account was logged in successfully.</p><p>If this was not you, reset your password immediately.</p>`
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar
      }
    });
  } catch (err) {
    res.status(500).json({ message: "Login failed", error: err.message });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    const [rows] = await pool.query("SELECT * FROM users WHERE email=?", [email]);
    const user = rows[0];

    if (!user) return res.status(404).json({ message: "Email not found" });

    const resetToken = crypto.randomBytes(32).toString("hex");
    const expiry = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      "UPDATE users SET reset_token=?, reset_token_expiry=? WHERE id=?",
      [resetToken, expiry, user.id]
    );

    const link = `${process.env.APP_URL || "http://localhost:" + PORT}?reset=${resetToken}`;

    await sendEmail(
      user.email,
      "Password Reset",
      `<h2>Password Reset</h2><p>Click the link below to reset your password:</p><a href="${link}">${link}</a><p>This link expires in 15 minutes.</p>`
    );

    res.json({ message: "Password reset email sent" });
  } catch (err) {
    res.status(500).json({ message: "Password reset failed", error: err.message });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;

    const [rows] = await pool.query(
      "SELECT * FROM users WHERE reset_token=? AND reset_token_expiry > NOW()",
      [token]
    );

    const user = rows[0];
    if (!user) return res.status(400).json({ message: "Invalid or expired reset token" });

    const hashed = await bcrypt.hash(password, 12);

    await pool.query(
      "UPDATE users SET password=?, reset_token=NULL, reset_token_expiry=NULL WHERE id=?",
      [hashed, user.id]
    );

    await sendEmail(
      user.email,
      "Password Changed",
      `<p>Your password was changed successfully.</p>`
    );

    res.json({ message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ message: "Password reset failed", error: err.message });
  }
});

app.get("/api/auth/me", auth(), async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id,name,email,phone,role,status,avatar,last_login,created_at FROM users WHERE id=?",
    [req.user.id]
  );

  res.json(rows[0]);
});

/* ========================= CUSTOMER PRODUCTS ========================= */

app.get("/api/products", async (req, res) => {
  try {
    const search = req.query.search || "";
    const category = req.query.category || "";
    const min = req.query.min || 0;
    const max = req.query.max || 999999999;

    let sql = `
      SELECT products.*, categories.name AS category_name
      FROM products
      LEFT JOIN categories ON products.category_id = categories.id
      WHERE products.status='active'
      AND (products.name LIKE ? OR products.description LIKE ? OR products.sku LIKE ?)
      AND (products.price - products.discount) BETWEEN ? AND ?
    `;

    const params = [`%${search}%`, `%${search}%`, `%${search}%`, min, max];

    if (category) {
      sql += " AND products.category_id=?";
      params.push(category);
    }

    sql += " ORDER BY products.created_at DESC";

    const [rows] = await pool.query(sql, params);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to load products", error: err.message });
  }
});

app.get("/api/categories", async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM categories ORDER BY name ASC");
  res.json(rows);
});

/* ========================= CART ========================= */

app.get("/api/cart", auth(["customer", "admin", "super_admin"]), async (req, res) => {
  const [rows] = await pool.query(
    `
    SELECT cart_items.*, products.name, products.price, products.discount, products.image, products.stock
    FROM cart_items
    JOIN products ON cart_items.product_id = products.id
    WHERE cart_items.user_id=?
    `,
    [req.user.id]
  );

  res.json(rows);
});

app.post("/api/cart", auth(["customer", "admin", "super_admin"]), async (req, res) => {
  try {
    const { product_id, quantity } = req.body;

    const qty = Number(quantity || 1);

    const [products] = await pool.query("SELECT * FROM products WHERE id=? AND status='active'", [
      product_id
    ]);

    const product = products[0];

    if (!product) return res.status(404).json({ message: "Product not found" });
    if (product.stock < qty) return res.status(400).json({ message: "Insufficient stock" });

    const [existing] = await pool.query(
      "SELECT * FROM cart_items WHERE user_id=? AND product_id=?",
      [req.user.id, product_id]
    );

    if (existing.length) {
      await pool.query(
        "UPDATE cart_items SET quantity = quantity + ? WHERE user_id=? AND product_id=?",
        [qty, req.user.id, product_id]
      );
    } else {
      await pool.query(
        "INSERT INTO cart_items (user_id,product_id,quantity) VALUES (?,?,?)",
        [req.user.id, product_id, qty]
      );
    }

    res.json({ message: "Added to cart" });
  } catch (err) {
    res.status(500).json({ message: "Cart update failed", error: err.message });
  }
});

app.put("/api/cart/:id", auth(["customer", "admin", "super_admin"]), async (req, res) => {
  const qty = Math.max(1, Number(req.body.quantity || 1));

  await pool.query("UPDATE cart_items SET quantity=? WHERE id=? AND user_id=?", [
    qty,
    req.params.id,
    req.user.id
  ]);

  res.json({ message: "Cart quantity updated" });
});

app.delete("/api/cart/:id", auth(["customer", "admin", "super_admin"]), async (req, res) => {
  await pool.query("DELETE FROM cart_items WHERE id=? AND user_id=?", [req.params.id, req.user.id]);
  res.json({ message: "Removed from cart" });
});

/* ========================= WISHLIST ========================= */

app.get("/api/wishlist", auth(["customer", "admin", "super_admin"]), async (req, res) => {
  const [rows] = await pool.query(
    `
    SELECT wishlist.*, products.name, products.price, products.discount, products.image
    FROM wishlist
    JOIN products ON wishlist.product_id = products.id
    WHERE wishlist.user_id=?
    `,
    [req.user.id]
  );

  res.json(rows);
});

app.post("/api/wishlist", auth(["customer", "admin", "super_admin"]), async (req, res) => {
  await pool.query("INSERT IGNORE INTO wishlist (user_id,product_id) VALUES (?,?)", [
    req.user.id,
    req.body.product_id
  ]);

  res.json({ message: "Added to wishlist" });
});

app.delete("/api/wishlist/:productId", auth(["customer", "admin", "super_admin"]), async (req, res) => {
  await pool.query("DELETE FROM wishlist WHERE user_id=? AND product_id=?", [
    req.user.id,
    req.params.productId
  ]);

  res.json({ message: "Removed from wishlist" });
});

/* ========================= ORDERS ========================= */

app.post("/api/orders", auth(["customer", "admin", "super_admin"]), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { address, phone, payment_method, notes, coupon_code } = req.body;

    const [cart] = await connection.query(
      `
      SELECT cart_items.*, products.name, products.price, products.discount, products.stock
      FROM cart_items
      JOIN products ON cart_items.product_id = products.id
      WHERE cart_items.user_id=?
      `,
      [req.user.id]
    );

    if (!cart.length) {
      await connection.rollback();
      return res.status(400).json({ message: "Cart is empty" });
    }

    let subtotal = 0;

    for (const item of cart) {
      if (item.quantity > item.stock) {
        await connection.rollback();
        return res.status(400).json({ message: `${item.name} has insufficient stock` });
      }

      subtotal += (Number(item.price) - Number(item.discount || 0)) * item.quantity;
    }

    let discount = 0;

    if (coupon_code) {
      const [coupons] = await connection.query(
        "SELECT * FROM coupons WHERE code=? AND active=TRUE AND (expires_at IS NULL OR expires_at > NOW())",
        [coupon_code]
      );

      if (coupons.length) {
        discount = subtotal * (Number(coupons[0].discount_percent) / 100);
      }
    }

    const tax = subtotal * 0.0;
    const shipping_fee = subtotal > 5000 ? 0 : 300;
    const total = subtotal + tax + shipping_fee - discount;
    const orderCode = makeOrderCode();

    const [orderResult] = await connection.query(
      `
      INSERT INTO orders 
      (order_code,user_id,total,shipping_fee,tax,discount,payment_method,address,phone,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      `,
      [
        orderCode,
        req.user.id,
        total,
        shipping_fee,
        tax,
        discount,
        payment_method,
        address,
        phone,
        notes || ""
      ]
    );

    const orderId = orderResult.insertId;

    for (const item of cart) {
      const price = Number(item.price) - Number(item.discount || 0);

      await connection.query(
        `
        INSERT INTO order_items (order_id,product_id,product_name,quantity,price)
        VALUES (?,?,?,?,?)
        `,
        [orderId, item.product_id, item.name, item.quantity, price]
      );

      await connection.query("UPDATE products SET stock = stock - ? WHERE id=?", [
        item.quantity,
        item.product_id
      ]);
    }

    await connection.query("DELETE FROM cart_items WHERE user_id=?", [req.user.id]);

    await connection.query(
      `
      INSERT INTO payments (order_id,user_id,method,amount,phone,status)
      VALUES (?,?,?,?,?,?)
      `,
      [orderId, req.user.id, payment_method, total, phone, "pending"]
    );

    await connection.query(
      `
      INSERT INTO invoices (order_id,invoice_code,amount,status)
      VALUES (?,?,?,?)
      `,
      [orderId, makeInvoiceCode(), total, "unpaid"]
    );

    await connection.commit();

    await sendEmail(
      req.user.email,
      "Order Created",
      `<h2>Your order has been created</h2><p>Order: ${orderCode}</p><p>Total: KSh ${total}</p>`
    );

    res.json({
      message: "Order placed successfully",
      order_id: orderId,
      order_code: orderCode,
      total
    });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ message: "Order failed", error: err.message });
  } finally {
    connection.release();
  }
});

app.get("/api/my-orders", auth(["customer", "admin", "super_admin"]), async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC",
    [req.user.id]
  );

  res.json(rows);
});

app.get("/api/my-orders/:id/items", auth(["customer", "admin", "super_admin"]), async (req, res) => {
  const [rows] = await pool.query(
    `
    SELECT order_items.*
    FROM order_items
    JOIN orders ON order_items.order_id = orders.id
    WHERE order_items.order_id=? AND orders.user_id=?
    `,
    [req.params.id, req.user.id]
  );

  res.json(rows);
});

/* ========================= CUSTOMER SUPPORT ========================= */

app.post("/api/messages", auth(["customer", "admin", "super_admin"]), async (req, res) => {
  const { subject, message } = req.body;

  await pool.query("INSERT INTO messages (user_id,subject,message) VALUES (?,?,?)", [
    req.user.id,
    subject,
    message
  ]);

  res.json({ message: "Message sent to support" });
});

/* ========================= ADMIN DASHBOARD ========================= */

app.get("/api/admin/stats", auth(["admin", "super_admin"]), async (req, res) => {
  const [[users]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role='customer'");
  const [[products]] = await pool.query("SELECT COUNT(*) AS total FROM products");
  const [[orders]] = await pool.query("SELECT COUNT(*) AS total FROM orders");
  const [[pending]] = await pool.query("SELECT COUNT(*) AS total FROM orders WHERE order_status='pending'");
  const [[revenue]] = await pool.query("SELECT COALESCE(SUM(total),0) AS total FROM orders WHERE payment_status='paid'");
  const [[todaySales]] = await pool.query(
    "SELECT COALESCE(SUM(total),0) AS total FROM orders WHERE DATE(created_at)=CURDATE()"
  );
  const [[lowStock]] = await pool.query("SELECT COUNT(*) AS total FROM products WHERE stock <= 5");

  res.json({
    users: users.total,
    products: products.total,
    orders: orders.total,
    pendingOrders: pending.total,
    revenue: revenue.total,
    todaySales: todaySales.total,
    lowStock: lowStock.total
  });
});

app.get("/api/admin/analytics", auth(["admin", "super_admin"]), async (req, res) => {
  const [monthly] = await pool.query(`
    SELECT 
      DATE_FORMAT(created_at, '%b') AS month,
      COALESCE(SUM(total),0) AS sales,
      COUNT(*) AS orders
    FROM orders
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
    GROUP BY YEAR(created_at), MONTH(created_at), DATE_FORMAT(created_at, '%b')
    ORDER BY YEAR(created_at), MONTH(created_at)
  `);

  const [topProducts] = await pool.query(`
    SELECT 
      product_name,
      SUM(quantity) AS quantity,
      SUM(quantity * price) AS revenue
    FROM order_items
    GROUP BY product_name
    ORDER BY quantity DESC
    LIMIT 6
  `);

  const [traffic] = await pool.query(`
    SELECT 'Direct' AS source, 143382 AS value
    UNION SELECT 'Referral', 87974
    UNION SELECT 'Social Media', 45211
    UNION SELECT 'Twitter', 21893
    UNION SELECT 'Facebook', 21893
  `);

  res.json({
    monthly,
    topProducts,
    traffic
  });
});

app.get("/api/admin/products", auth(["admin", "super_admin"]), async (req, res) => {
  const [rows] = await pool.query(`
    SELECT products.*, categories.name AS category_name
    FROM products
    LEFT JOIN categories ON products.category_id = categories.id
    ORDER BY products.created_at DESC
  `);

  res.json(rows);
});

app.post("/api/admin/products", auth(["admin", "super_admin"]), async (req, res) => {
  const { category_id, name, sku, description, price, discount, stock, image, featured, status } =
    req.body;

  await pool.query(
    `
    INSERT INTO products 
    (category_id,name,sku,description,price,discount,stock,image,featured,status)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    `,
    [
      category_id || null,
      name,
      sku || "",
      description || "",
      price || 0,
      discount || 0,
      stock || 0,
      image || "",
      featured ? true : false,
      status || "active"
    ]
  );

  await logAction(req.user.id, `Added product: ${name}`, req);

  res.json({ message: "Product added successfully" });
});

app.put("/api/admin/products/:id", auth(["admin", "super_admin"]), async (req, res) => {
  const { category_id, name, sku, description, price, discount, stock, image, featured, status } =
    req.body;

  await pool.query(
    `
    UPDATE products
    SET category_id=?, name=?, sku=?, description=?, price=?, discount=?, stock=?, image=?, featured=?, status=?
    WHERE id=?
    `,
    [
      category_id || null,
      name,
      sku || "",
      description || "",
      price || 0,
      discount || 0,
      stock || 0,
      image || "",
      featured ? true : false,
      status || "active",
      req.params.id
    ]
  );

  res.json({ message: "Product updated successfully" });
});

app.delete("/api/admin/products/:id", auth(["admin", "super_admin"]), async (req, res) => {
  await pool.query("DELETE FROM products WHERE id=?", [req.params.id]);
  res.json({ message: "Product deleted successfully" });
});

app.get("/api/admin/orders", auth(["admin", "super_admin"]), async (req, res) => {
  const [rows] = await pool.query(`
    SELECT orders.*, users.name, users.email
    FROM orders
    LEFT JOIN users ON orders.user_id = users.id
    ORDER BY orders.created_at DESC
  `);

  res.json(rows);
});

app.put("/api/admin/orders/:id", auth(["admin", "super_admin"]), async (req, res) => {
  const { order_status, payment_status } = req.body;

  await pool.query(
    "UPDATE orders SET order_status=?, payment_status=? WHERE id=?",
    [order_status, payment_status, req.params.id]
  );

  const [orders] = await pool.query(
    `
    SELECT orders.*, users.email, users.name
    FROM orders
    LEFT JOIN users ON orders.user_id = users.id
    WHERE orders.id=?
    `,
    [req.params.id]
  );

  const order = orders[0];

  if (order?.email) {
    await sendEmail(
      order.email,
      "Order Status Updated",
      `<h2>Hello ${order.name || ""}</h2><p>Your order ${order.order_code} is now <b>${order_status}</b>.</p><p>Payment status: ${payment_status}</p>`
    );
  }

  res.json({ message: "Order updated successfully" });
});

app.get("/api/admin/customers", auth(["admin", "super_admin"]), async (req, res) => {
  const [rows] = await pool.query(`
    SELECT 
      users.id,
      users.name,
      users.email,
      users.phone,
      users.status,
      users.last_login,
      users.created_at,
      COUNT(orders.id) AS total_orders,
      COALESCE(SUM(orders.total),0) AS total_spent
    FROM users
    LEFT JOIN orders ON users.id = orders.user_id
    WHERE users.role='customer'
    GROUP BY users.id
    ORDER BY users.created_at DESC
  `);

  res.json(rows);
});

app.put("/api/admin/customers/:id/status", auth(["admin", "super_admin"]), async (req, res) => {
  const { status } = req.body;

  await pool.query("UPDATE users SET status=? WHERE id=? AND role='customer'", [
    status,
    req.params.id
  ]);

  res.json({ message: "Customer status updated" });
});

app.get("/api/admin/invoices", auth(["admin", "super_admin"]), async (req, res) => {
  const [rows] = await pool.query(`
    SELECT invoices.*, orders.order_code, users.name, users.email
    FROM invoices
    LEFT JOIN orders ON invoices.order_id = orders.id
    LEFT JOIN users ON orders.user_id = users.id
    ORDER BY invoices.created_at DESC
  `);

  res.json(rows);
});

app.get("/api/admin/messages", auth(["admin", "super_admin"]), async (req, res) => {
  const [rows] = await pool.query(`
    SELECT messages.*, users.name, users.email
    FROM messages
    LEFT JOIN users ON messages.user_id = users.id
    ORDER BY messages.created_at DESC
  `);

  res.json(rows);
});

app.put("/api/admin/messages/:id", auth(["admin", "super_admin"]), async (req, res) => {
  await pool.query("UPDATE messages SET status=? WHERE id=?", [req.body.status, req.params.id]);
  res.json({ message: "Message updated" });
});

app.get("/api/admin/coupons", auth(["admin", "super_admin"]), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM coupons ORDER BY created_at DESC");
  res.json(rows);
});

app.post("/api/admin/coupons", auth(["admin", "super_admin"]), async (req, res) => {
  const { code, discount_percent, expires_at } = req.body;

  await pool.query(
    "INSERT INTO coupons (code,discount_percent,expires_at,active) VALUES (?,?,?,TRUE)",
    [code, discount_percent, expires_at || null]
  );

  res.json({ message: "Coupon created" });
});

app.put("/api/admin/coupons/:id", auth(["admin", "super_admin"]), async (req, res) => {
  const { active } = req.body;

  await pool.query("UPDATE coupons SET active=? WHERE id=?", [active ? true : false, req.params.id]);

  res.json({ message: "Coupon updated" });
});

app.get("/api/admin/logs", auth(["admin", "super_admin"]), async (req, res) => {
  const [rows] = await pool.query(`
    SELECT activity_logs.*, users.name, users.email
    FROM activity_logs
    LEFT JOIN users ON activity_logs.user_id = users.id
    ORDER BY activity_logs.created_at DESC
    LIMIT 100
  `);

  res.json(rows);
});

/* ========================= SUPER ADMIN ========================= */

app.post("/api/super/admins", auth(["super_admin"]), async (req, res) => {
  const { name, email, phone, password, role } = req.body;

  const hashed = await bcrypt.hash(password, 12);

  await pool.query(
    "INSERT INTO users (name,email,phone,password,role,status) VALUES (?,?,?,?,?,?)",
    [name, email, phone || "", hashed, role || "admin", "active"]
  );

  res.json({ message: "Admin created successfully" });
});

app.get("/api/super/admins", auth(["super_admin"]), async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id,name,email,phone,role,status,last_login,created_at FROM users WHERE role IN ('admin','super_admin') ORDER BY created_at DESC"
  );

  res.json(rows);
});

/* ========================= PAYMENT PLACEHOLDER ========================= */

app.post("/api/payments/mpesa/stk", auth(["customer", "admin", "super_admin"]), async (req, res) => {
  const { order_id, phone, amount } = req.body;

  res.json({
    message: "M-Pesa STK endpoint ready",
    order_id,
    phone,
    amount,
    note: "Connect Daraja API credentials here for real STK push."
  });
});

app.post("/api/payments/mpesa/callback", async (req, res) => {
  console.log("M-Pesa Callback:", JSON.stringify(req.body, null, 2));
  res.json({ ResultCode: 0, ResultDesc: "Callback received" });
});

/* ========================= FRONTEND ========================= */

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ========================= START SERVER ========================= */

async function start() {
  try {
    await connectDB();
    await initDatabase();

    app.listen(PORT, () => {
      console.log(`ShopMaster Pro running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Server startup failed:", err);
    process.exit(1);
  }
}

start();
