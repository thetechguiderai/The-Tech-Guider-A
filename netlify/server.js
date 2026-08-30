if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.listen(PORT, () => console.log(`✅ The Tech Guider AI running at http://localhost:${PORT}`));
}

export default app;