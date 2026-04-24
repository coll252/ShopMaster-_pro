require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 5000;

/* ================= DATABASE ================= */

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

/* ================= EMAIL (SAFE NON-BLOCKING) ================= */

async function sendEmail(to, subject, html) {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.log("Email skipped (no credentials)");
      return;
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      html
    });

  } catch (err) {
    console.log("Email error:", err.message);
  }
}

/* ================= AUTH ================= */

function createToken(user) {
  return jwt.sign(user, process.env.JWT_SECRET || "secret", {
    expiresIn: "7d"
  });
}

/* ================= INIT TABLES ================= */

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100),
      email VARCHAR(150) UNIQUE,
      phone VARCHAR(50),
      password TEXT,
      role VARCHAR(20) DEFAULT 'customer',
      status VARCHAR(20) DEFAULT 'active',
      reset_token TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150),
      price DECIMAL(10,2),
      stock INT DEFAULT 10,
      image TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cart (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      product_id INT,
      qty INT
    )
  `);

  const [products] = await pool.query("SELECT * FROM products");
  if (products.length === 0) {
    await pool.query(`
      INSERT INTO products (name,price,stock,image) VALUES
      ('Phone',20000,20,''),
      ('Shoes',3000,50,''),
      ('Laptop',80000,10,'')
    `);
  }

  console.log("DB READY");
}

/* ================= ROUTES ================= */

/* REGISTER */
app.post("/api/auth/register", async (req, res) => {
  try {
    const name = req.body.name;
    const email = req.body.email;
    const password = req.body.password;

    if (!name || !email || !password)
      return res.status(400).json({ message: "Missing fields" });

    const [exists] = await pool.query("SELECT * FROM users WHERE email=?", [email]);
    if (exists.length)
      return res.status(400).json({ message: "Email exists" });

    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO users (name,email,password,role,status) VALUES (?,?,?,?,?)",
      [name, email, hash, "customer", "active"]
    );

    sendEmail(email, "Welcome", "<h2>Welcome to ShopMaster</h2>");

    res.json({ message: "Registered successfully" });

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Registration error" });
  }
});

/* LOGIN */
app.post("/api/auth/login", async (req, res) => {
  try {
    const email = req.body.email;
    const password = req.body.password;

    const [rows] = await pool.query("SELECT * FROM users WHERE email=?", [email]);
    const user = rows[0];

    if (!user)
      return res.status(401).json({ message: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.password);

    if (!valid)
      return res.status(401).json({ message: "Invalid credentials" });

    const token = createToken({ id: user.id, role: user.role });

    res.json({
      message: "Login success",
      token,
      user
    });

  } catch (err) {
    res.status(500).json({ message: "Login error" });
  }
});

/* FORGOT PASSWORD */
app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const email = req.body.email;

    const [rows] = await pool.query("SELECT * FROM users WHERE email=?", [email]);
    const user = rows[0];

    if (!user)
      return res.json({ message: "If email exists, link sent" });

    const token = crypto.randomBytes(20).toString("hex");

    await pool.query(
      "UPDATE users SET reset_token=? WHERE id=?",
      [token, user.id]
    );

    const link = `${process.env.APP_URL}/?reset=${token}`;

    sendEmail(email, "Reset Password", `<a href="${link}">${link}</a>`);

    console.log("RESET LINK:", link);

    res.json({ message: "Reset link sent" });

  } catch {
    res.status(500).json({ message: "Error" });
  }
});

/* PRODUCTS */
app.get("/api/products", async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM products");
  res.json(rows);
});

/* ADD TO CART */
app.post("/api/cart", async (req, res) => {
  const { user_id, product_id } = req.body;

  await pool.query(
    "INSERT INTO cart (user_id,product_id,qty) VALUES (?,?,1)",
    [user_id, product_id]
  );

  res.json({ message: "Added to cart" });
});

/* ADMIN STATS */
app.get("/api/admin/stats", async (req, res) => {
  const [[users]] = await pool.query("SELECT COUNT(*) total FROM users");
  const [[products]] = await pool.query("SELECT COUNT(*) total FROM products");

  res.json({
    users: users.total,
    products: products.total
  });
});

/* FRONTEND */
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

/* START */
initDB().then(() => {
  app.listen(PORT, () => {
    console.log("SERVER RUNNING ON", PORT);
  });
});
