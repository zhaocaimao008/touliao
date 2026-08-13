class MockStatement {
  all() {
    return [];
  }
}

class MockDB {
  prepare(_sql) {
    return new MockStatement();
  }
}

module.exports = MockDB;
