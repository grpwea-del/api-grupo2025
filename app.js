import express from "express";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
const port = process.env.PORT || 10000;

// Conexão com o banco
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Rota principal
app.get("/", (req, res) => {
  res.send("✅ API do Grupo 2025 está online!");
});

// Endpoint /get_balance
app.get("/get_balance", async (req, res) => {
  const { empresa, ano } = req.query;

  if (!empresa || !ano) {
    return res.status(400).json({
      erro: "Informe ?empresa=Nome&ano=2024"
    });
  }

  try {
    const query = `
      SELECT *
      FROM balances
      WHERE company_name = $1 AND year = $2
    `;
    const result = await pool.query(query, [empresa, ano]);

    if (result.rows.length === 0) {
      return res.json({
        empresa,
        ano,
        aviso: "Nenhum dado encontrado. Exibindo exemplo fictício.",
        exemplo: {
          receita: 1250000,
          ebitda: 320000,
          lucro_liquido: 180000
        }
      });
    }

    res.json(result.rows);
  } catch (err) {
    console.error("Erro ao consultar banco:", err);
    res.status(500).json({ erro: "Falha ao buscar dados." });
  }
});

app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});
