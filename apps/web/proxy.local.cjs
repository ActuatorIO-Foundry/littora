const port = process.env.API_PORT || '3000';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error('API_PORT must be an integer between 1 and 65535');
}

module.exports = {
  '/api': {
    target: `http://127.0.0.1:${Number(port)}`,
    secure: false,
    changeOrigin: true,
  },
};
