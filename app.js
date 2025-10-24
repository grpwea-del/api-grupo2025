// app.js
import express from "express";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
const port = process.env.PORT || 10000;

app.use(express.json());

// 🔧 Cabeçalho padrão: força JSON UTF-8 em todas as respostas
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// 🔎 Log simples de requisições (útil na demo)
app.use((req, _res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

// Conexão com o banco (Render Postgres)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------------------------------------------------------------------
// Healthcheck
// ---------------------------------------------------------------------
app.get("/", (_req, res) => {
  res.send("✅ API do Grupo 2025 está online!");
});

// ---------------------------------------------------------------------
// GET /balances  (lista completa, útil para testes rápidos)
// ---------------------------------------------------------------------
app.get("/balances", async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT company_name, year,
             receita::text AS receita,
             ebitda::text AS ebitda,
             lucro_liquido::text AS lucro_liquido
      FROM balances
      ORDER BY company_name, year
    `);
    res.json(r.rows);
  } catch (e) {
    console.error("Erro /balances:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------
// GET /get_balance?empresa=Agência%20WE&ano=2024
// ---------------------------------------------------------------------
app.get("/get_balance", async (req, res) => {
  const empresa = req.query.empresa || req.query.company;
  const { ano } = req.query;

  if (!empresa || !ano) {
    return res.status(400).json({ erro: "Informe ?empresa=Nome&ano=2024" });
  }

  try {
    const query = `
      SELECT company_name, year,
             receita::text AS receita,
             ebitda::text AS ebitda,
             lucro_liquido::text AS lucro_liquido
      FROM balances
      WHERE LOWER(company_name) = LOWER($1) AND year = $2
    `;
    const result = await pool.query(query, [empresa, parseInt(ano, 10)]);
    if (result.rows.length === 0) return res.status(404).json({ erro: "not_found" });
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
      sql += " WHERE LOWER(co.nome) = LOWER($1)";
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
      sql += " WHERE LOWER(co.nome) = LOWER($1)";
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
app.get("/companies", async (_req, res) => {
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
        ${company ? "AND LOWER(c.nome) = LOWER($2)" : ""}
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
app.get("/init_all", async (_req, res) => {
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
// GET /leases_monthly[?year=2024][&company=Agência%20WE]
// ---------------------------------------------------------------------
app.get("/leases_monthly", async (req, res) => {
  try {
    const { year, company } = req.query;
    const params = [];
    const where = [];
    let sql = `
      SELECT 
        co.nome AS company_name,
        l.year,
        l.month,
        l.amount_paid::text AS amount_paid,
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
      where.push(`LOWER(co.nome) = LOWER($${params.length})`);
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
// GET /clients/revenue?company=Agência%20WE[&year=2024]
// ---------------------------------------------------------------------
app.get("/clients/revenue", async (req, res) => {
  try {
    const { company, year } = req.query;
    if (!company) return res.status(400).json({ erro: "Informe ?company=Nome" });

    const params = [company];
    let sql;
    if (year) {
      params.push(parseInt(year, 10));
      sql = `
        SELECT SUM(p.realized)::text AS faturamento
        FROM clients_performance p
        JOIN companies c ON c.id = p.company_id
        WHERE LOWER(c.nome) = LOWER($1) AND p.year = $2
      `;
    } else {
      sql = `
        SELECT p.year, SUM(p.realized)::text AS faturamento
        FROM clients_performance p
        JOIN companies c ON c.id = p.company_id
        WHERE LOWER(c.nome) = LOWER($1)
        GROUP BY p.year
        ORDER BY p.year
      `;
    }
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (e) {
    console.error("Erro /clients/revenue:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------
// GET /clients/top_commission_rate?company=Agência%20WE
// ---------------------------------------------------------------------
app.get("/clients/top_commission_rate", async (req, res) => {
  try {
    const { company } = req.query;
    if (!company) return res.status(400).json({ erro: "Informe ?company=Nome" });

    const sql = `
      SELECT p.client_name, AVG(p.commission_rate)::text AS maior_taxa
      FROM clients_performance p
      JOIN companies c ON c.id = p.company_id
      WHERE LOWER(c.nome) = LOWER($1)
      GROUP BY p.client_name
      ORDER BY maior_taxa DESC NULLS LAST
      LIMIT 1
    `;
    const r = await pool.query(sql, [company]);
    res.json(r.rows[0] || null);
  } catch (e) {
    console.error("Erro /clients/top_commission_rate:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------
// GET /clients/most_above_planned?company=Agência%20WE[&year=2024]
// ---------------------------------------------------------------------
app.get("/clients/most_above_planned", async (req, res) => {
  try {
    const { company, year } = req.query;
    if (!company) return res.status(400).json({ erro: "Informe ?company=Nome" });

    const params = [company];
    let whereYear = "";
    if (year) {
      whereYear = "AND p.year = $2";
      params.push(parseInt(year, 10));
    }

    const sql = `
      SELECT p.client_name,
             SUM(p.realized - p.planned)::text AS acima_previsto
      FROM clients_performance p
      JOIN companies c ON c.id = p.company_id
      WHERE LOWER(c.nome) = LOWER($1) ${whereYear}
      GROUP BY p.client_name
      ORDER BY acima_previsto DESC NULLS LAST
      LIMIT 1
    `;
    const r = await pool.query(sql, params);
    res.json(r.rows[0] || null);
  } catch (e) {
    console.error("Erro /clients/most_above_planned:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------
// GET /clients/top_commission_value?company=Agência%20WE[&year=2024]
// ---------------------------------------------------------------------
app.get("/clients/top_commission_value", async (req, res) => {
  try {
    const { company, year } = req.query;
    if (!company) return res.status(400).json({ erro: "Informe ?company=Nome" });

    const params = [company];
    let whereYear = "";
    if (year) {
      whereYear = "AND p.year = $2";
      params.push(parseInt(year, 10));
    }

    const sql = `
      SELECT p.client_name,
             SUM(p.commission_value)::text AS valor_comissao
      FROM clients_performance p
      JOIN companies c ON c.id = p.company_id
      WHERE LOWER(c.nome) = LOWER($1) ${whereYear}
      GROUP BY p.client_name
      ORDER BY valor_comissao DESC NULLS LAST
      LIMIT 1
    `;
    const r = await pool.query(sql, params);
    res.json(r.rows[0] || null);
  } catch (e) {
    console.error("Erro /clients/top_commission_value:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------
// GET /pr_materials_last[?company=Agência%20WE]
// ---------------------------------------------------------------------
app.get("/pr_materials_last", async (req, res) => {
  try {
    const { company } = req.query;
    const params = [];
    let sql = `
      SELECT 
        p.id,
        c.nome AS company_name,
        p.titulo,
        p.data_publicacao,
        p.valor_gerado::text AS valor_gerado,
        p.conteudo
      FROM pr_materials p
      JOIN companies c ON c.id = p.company_id
    `;
    if (company) {
      sql += " WHERE LOWER(c.nome) = LOWER($1)";
      params.push(company);
    }
    sql += " ORDER BY p.data_publicacao DESC NULLS LAST, p.created_at DESC LIMIT 1";
    const r = await pool.query(sql, params);
    res.json({ item: r.rows[0] || null });
  } catch (e) {
    console.error("Erro /pr_materials_last:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------
// GET /employees_summary[?company=Agência%20WE]
// ---------------------------------------------------------------------
app.get("/employees_summary", async (req, res) => {
  try {
    const { company } = req.query;
    if (!company) {
      return res.status(400).json({ erro: "Informe ?company=Nome" });
    }

    const sql = `
      SELECT e.nome, e.cargo, e.salario::text AS salario
      FROM employees e
      JOIN companies c ON c.id = e.company_id
      WHERE LOWER(c.nome) = LOWER($1)
      ORDER BY e.nome
    `;
    const r = await pool.query(sql, [company]);

    res.json({
      company,
      total_funcionarios: r.rowCount,
      funcionarios: r.rows
    });
  } catch (e) {
    console.error("Erro /employees_summary:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------
// 404 Fallback
// ---------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ erro: "endpoint não encontrado" });
});

// ---------------------------------------------------------------------
// Inicialização do servidor
// ---------------------------------------------------------------------
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});
