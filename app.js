// app.js
import express from "express";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
const port = process.env.PORT || 10000;

app.use(express.json());

// Conexão com o banco (Render Postgres)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------------------------------------------------------------------
// Healthcheck
// ---------------------------------------------------------------------
app.get("/", (req, res) => {
  res.send("✅ API do Grupo 2025 está online!");
});

// ---------------------------------------------------------------------
// GET /get_balance?empresa=Agência%20WE&ano=2024
// ---------------------------------------------------------------------
app.get("/get_balance", async (req, res) => {
  // 🔧 Suporte a "empresa" ou "company"
  const empresa = req.query.empresa || req.query.company;
  const { ano } = req.query;

  if (!empresa || !ano) {
    return res.status(400).json({ erro: "Informe ?empresa=Nome&ano=2024" });
  }

  try {
    const query = `
      SELECT company_name, year, receita::text AS receita,
             ebitda::text AS ebitda, lucro_liquido::text AS lucro_liquido
      FROM balances
      WHERE company_name = $1 AND year = $2
    `;
    const result = await pool.query(query, [empresa, parseInt(ano, 10)]);

    // 🔧 Não inventar dado — se não encontrar, retorna 404
    if (result.rows.length === 0) {
      return res.status(404).json({ erro: "not_found" });
    }

    res.json(result.rows);
  } catch (err) {
    console.error("Erro ao consultar banco:", err);
    res.status(500).json({ erro: "Falha ao buscar dados." });
  }
});

// ---------------------------------------------------------------------
// GET /campaigns_count[?company]
// ---------------------------------------------------------------------
app.get("/campaigns_count", async (req, res) => {
  try {
    const { company } = req.query;
    const params = [];
    let sql = `
      SELECT COUNT(*)::int AS total
      FROM campaigns c
      JOIN companies co ON co.id = c.company_id
    `;
    if (company) {
      sql += " WHERE co.nome = $1";
      params.push(company);
    }
    const r = await pool.query(sql, params);
    res.json({ total: r.rows[0]?.total ?? 0 });
  } catch (e) {
    console.error("Erro /campaigns_count:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------
// GET /campaigns_last[?company]
// ---------------------------------------------------------------------
app.get("/campaigns_last", async (req, res) => {
  try {
    const { company } = req.query;
    const params = [];
    let sql = `
      SELECT 
        c.id,
        co.nome AS company_name,
        c.titulo,
        c.data_veiculacao,
        c.valor_investido::text AS valor_investido,
        c.retorno::text AS retorno
      FROM campaigns c
      JOIN companies co ON co.id = c.company_id
    `;
    if (company) {
      sql += " WHERE co.nome = $1";
      params.push(company);
    }
    sql += " ORDER BY c.data_veiculacao DESC NULLS LAST, c.id DESC LIMIT 1";
    const r = await pool.query(sql, params);
    res.json({ item: r.rows[0] || null });
  } catch (e) {
    console.error("Erro /campaigns_last:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------
// GET /companies
// ---------------------------------------------------------------------
app.get("/companies", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, nome, area, descricao FROM companies ORDER BY id"
    );
    res.json(result.rows);
  } catch (e) {
    console.error("Erro /companies:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------
// GET /leases_max?year=2024[&company=Agência%20WE]
// 🔧 amount_paid agora padronizado como texto (string)
// ---------------------------------------------------------------------
app.get("/leases_max", async (req, res) => {
  try {
    const { year, company } = req.query;
    if (!year) {
      return res.status(400).json({ erro: "Informe ?year=2024 (e opcionalmente &company=Nome)" });
    }

    const params = [parseInt(year, 10)];
    let sql = `
      WITH ranked AS (
        SELECT
          l.year, l.month, l.amount_paid::text AS amount_paid, l.machines_count,
          ROW_NUMBER() OVER (PARTITION BY l.year ORDER BY l.amount_paid DESC) AS rn
        FROM leases_monthly_machines l
        ${company ? "JOIN companies c ON c.id = l.company_id" : ""}
        WHERE l.year = $1
        ${company ? "AND c.nome = $2" : ""}
      )
      SELECT year, month, amount_paid, machines_count
      FROM ranked
      WHERE rn = 1
    `;
    if (company) params.push(company);

    const r = await pool.query(sql, params);
    return res.json(r.rows[0] || null);
  } catch (e) {
    console.error("Erro /leases_max:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------
// GET /init_all
// ---------------------------------------------------------------------
app.get("/init_all", async (req, res) => {
  try {
    const [companies, leasesMax2024, leasesMax2025] = await Promise.all([
      pool.query("SELECT id, nome, area, descricao FROM companies ORDER BY id"),
      pool.query(`
        SELECT c.nome AS company, l.year, l.month, l.amount_paid::text AS amount_paid, l.machines_count
        FROM leases_monthly_machines l
        JOIN companies c ON c.id = l.company_id
        WHERE l.year = 2024
      `),
      pool.query(`
        SELECT c.nome AS company, l.year, l.month, l.amount_paid::text AS amount_paid, l.machines_count
        FROM leases_monthly_machines l
        JOIN companies c ON c.id = l.company_id
        WHERE l.year = 2025
      `)
    ]);

    res.json({
      companies: companies.rows,
      leases_2024: leasesMax2024.rows,
      leases_2025: leasesMax2025.rows
    });
  } catch (e) {
    console.error("Erro /init_all:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------
// RESTANTE DOS ENDPOINTS (leases_monthly, clients, etc.)
// ... sem mudanças (mantêm formato atual)
// ---------------------------------------------------------------------

app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});
