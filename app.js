// app.js
import express from "express";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
const port = process.env.PORT || 10000;

// Middleware básico
app.use(express.json());

// Conexão com o banco (Render Postgres)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------------------------------------------------------------------
// Rota principal (healthcheck)
// ---------------------------------------------------------------------
app.get("/", (req, res) => {
  res.send("✅ API do Grupo 2025 está online!");
});

// ---------------------------------------------------------------------
// GET /get_balance?empresa=Grupo%20WE&ano=2024
// Retorna os dados financeiros de uma empresa em um determinado ano
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
// Retorna o número total de campanhas, opcionalmente filtrando por empresa
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
// GET /campaigns_last
// GET /campaigns_last?company=Grupo%20WE
// Retorna a última campanha (mais recente) de uma empresa ou geral
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
        c.valor_investido,
        c.retorno
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
// -> lista todas as empresas (id, nome, área, descrição)
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
// GET /leases_max?year=2024
// GET /leases_max?year=2024&company=Agência%20WE
// Retorna o mês de MAIOR valor pago (geral ou por empresa) e as máquinas
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
          l.year, l.month, l.amount_paid, l.machines_count,
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
// -> carrega dados iniciais de todas as tabelas relevantes
// ---------------------------------------------------------------------
app.get("/init_all", async (req, res) => {
  try {
    const [companies, leasesMax2024, leasesMax2025] = await Promise.all([
      pool.query("SELECT id, nome, area, descricao FROM companies ORDER BY id"),
      pool.query(`
        SELECT c.nome AS company, l.year, l.month, l.amount_paid, l.machines_count
        FROM leases_monthly_machines l
        JOIN companies c ON c.id = l.company_id
        WHERE l.year = 2024
      `),
      pool.query(`
        SELECT c.nome AS company, l.year, l.month, l.amount_paid, l.machines_count
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
// GET /leases_monthly
// /leases_monthly
// /leases_monthly?year=2024
// /leases_monthly?year=2024&company=Agência WE
// Retorna os registros mensais (empresa, ano, mês, valor, máquinas)
// ---------------------------------------------------------------------
app.get("/leases_monthly", async (req, res) => {
  try {
    const { year, company } = req.query;

    const params = [];
    let where = [];
    let sql = `
      SELECT 
        co.nome AS company_name,
        l.year,
        l.month,
        l.amount_paid::text AS amount_paid,  -- devolve como texto (pg numeric)
        l.machines_count
      FROM public.leases_monthly_machines l
      JOIN public.companies co ON co.id = l.company_id
    `;

    if (year) {
      params.push(parseInt(year, 10));
      where.push(`l.year = $${params.length}`);
    }
    if (company) {
      params.push(company);
      where.push(`co.nome = $${params.length}`);
    }
    if (where.length) sql += " WHERE " + where.join(" AND ");

    sql += " ORDER BY co.nome, l.year, l.month";

    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (e) {
    console.error("Erro /leases_monthly:", e);
    res.status(500).json({ error: "server_error" });
  }
});


// ---------------------------------------------------------------------
// Inicialização do servidor
// ---------------------------------------------------------------------
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});
// atualização para forçar deploy
