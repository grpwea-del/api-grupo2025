// app.js
import express from "express";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
const port = process.env.PORT || 10000;

// middlewares básicos
app.use(express.json());

// Conexão com o banco (Render Postgres)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Rota principal (healthcheck)
app.get("/", (req, res) => {
  res.send("✅ API do Grupo 2025 está online!");
});

// ---------------------------------------------------------------------
// GET /get_balance?empresa=Grupo%20WE&ano=2024
// ---------------------------------------------------------------------
app.get("/get_balance", async (req, res) => {
  const { empresa, ano } = req.query;

  if (!empresa || !ano) {
    return res.status(400).json({
      erro: "Informe ?empresa=Nome&ano=2024",
    });
  }

  try {
    const query = `
      SELECT *
      FROM balances
      WHERE company_name = $1 AND year = $2
    `;
    const result = await pool.query(query, [empresa, parseInt(ano, 10)]);

    if (result.rows.length === 0) {
      return res.json({
        empresa,
        ano: parseInt(ano, 10),
        aviso: "Nenhum dado encontrado. Exibindo exemplo fictício.",
        exemplo: {
          receita: 1250000,
          ebitda: 320000,
          lucro_liquido: 180000,
        },
      });
    }

    res.json(result.rows);
  } catch (err) {
    console.error("Erro ao consultar banco:", err);
    res.status(500).json({ erro: "Falha ao buscar dados." });
  }
});

// ---------------------------------------------------------------------
// GET /campaigns_count
// GET /campaigns_count?company=Grupo%20WE
// -> { total: number }
// ---------------------------------------------------------------------
app.get("/campaigns_count", async (req, res) => {
  try {
    const { company } = req.query; // opcional
    const params = [];
    let sql = "SELECT COUNT(*)::int AS total FROM campaigns";
    if (company) {
      sql += " WHERE company_name = $1";
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
// GET /campaigns_last
// GET /campaigns_last?company=Grupo%20WE
// -> { item: { id, company_name, titulo, canal, data_veiculacao, valor_investido, retorno } | null }
// ---------------------------------------------------------------------
app.get("/campaigns_last", async (req, res) => {
  try {
    const { company } = req.query; // opcional
    const params = [];
    let sql = `
      SELECT id, company_name, titulo, data_veiculacao, valor_investido, retorno
      FROM campaigns
    `;
    if (company) { sql += " WHERE company_name = $1"; params.push(company); }
    sql += " ORDER BY data_veiculacao DESC NULLS LAST, id DESC LIMIT 1";
    const r = await pool.query(sql, params);
    res.json({ item: r.rows[0] || null });
  } catch (e) {
    console.error("Erro /campaigns_last:", e);
    res.status(500).json({ error: "server_error" });
  }
});


// start
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});
