'use strict';

const mockClient = {
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  release: jest.fn(),
};

const Pool = jest.fn().mockImplementation(() => ({
  connect: jest.fn().mockResolvedValue(mockClient),
  query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 }),
  end: jest.fn().mockResolvedValue(undefined),
}));

module.exports = { Pool };
