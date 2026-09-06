const registerController = require('./register-controller');
const izlaznost = require('./izlaznost');
const status = require('./status');
const rezultati = require('./rezultati');

module.exports = {
  registerController,
  izlaznost,
  status,
  rezultati,
  list: [registerController, izlaznost, status, rezultati]
};
