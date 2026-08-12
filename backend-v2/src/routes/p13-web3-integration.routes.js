/**
 * P13: Web3 集成路由
 * 区块链交易、NFT、DAO 治理
 */
const express = require('express');
const router = express.Router();

const BlockchainIntegration = require('../utils/optimization-p13/blockchainIntegration');
const NFTSocialFeatures = require('../utils/optimization-p13/nftSocialFeatures');
const DAOGovernance = require('../utils/optimization-p13/daoGovernance');

// 单例
const blockchain = new BlockchainIntegration();
const nftSocial = new NFTSocialFeatures();
const dao = new DAOGovernance();

/**
 * 区块链 - 发起交易
 */
router.post('/blockchain/transaction', async (req, res) => {
  const { fromUser, toUser, amount, metadata } = req.body;
  try {
    const tx = await blockchain.initiateTransaction(fromUser, toUser, amount, metadata);
    res.json(tx);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * 区块链 - 查询交易状态
 */
router.get('/blockchain/transaction/:txHash', (req, res) => {
  const { txHash } = req.params;
  const status = blockchain.getTransactionStatus(txHash);
  res.json(status);
});

/**
 * 区块链 - 查询钱包余额
 */
router.get('/blockchain/balance/:wallet', async (req, res) => {
  const { wallet } = req.params;
  try {
    const balance = await blockchain.getBalance(wallet);
    res.json(balance);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * NFT - 铸造
 */
router.post('/nft/mint', async (req, res) => {
  const { creator, metadata } = req.body;
  try {
    const nft = await blockchain.mintNFT(creator, metadata);
    res.json(nft);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * NFT - 创建收藏
 */
router.post('/nft/collection', async (req, res) => {
  const { creator, name, description } = req.body;
  try {
    const collection = await nftSocial.createCollection(creator, name, description);
    res.json(collection);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * NFT - 交易
 */
router.post('/nft/trade', async (req, res) => {
  const { seller, buyer, nftId, price } = req.body;
  try {
    const result = await nftSocial.tradeNFT(seller, buyer, nftId, price);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * NFT - 社交互动
 */
router.post('/nft/interact', async (req, res) => {
  const { userId, nftId, type, content } = req.body;
  try {
    const interaction = await nftSocial.addSocialInteraction(userId, nftId, type, content);
    res.json(interaction);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * NFT - 排行榜
 */
router.get('/nft/leaderboard', (req, res) => {
  const limit = parseInt(req.query.limit || 10);
  const leaderboard = nftSocial.getLeaderboard(limit);
  res.json(leaderboard);
});

/**
 * DAO - 创建提案
 */
router.post('/dao/proposal', async (req, res) => {
  const { creator, title, description, options } = req.body;
  try {
    const proposal = await dao.createProposal(creator, title, description, options);
    res.json(proposal);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * DAO - 投票
 */
router.post('/dao/vote', async (req, res) => {
  const { voter, proposalId, optionIndex } = req.body;
  try {
    const result = await dao.vote(voter, proposalId, optionIndex);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * DAO - 执行提案
 */
router.post('/dao/execute/:proposalId', async (req, res) => {
  const { proposalId } = req.params;
  try {
    const result = await dao.executeProposal(proposalId);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * DAO - 提案统计
 */
router.get('/dao/proposal/:proposalId/stats', (req, res) => {
  const { proposalId } = req.params;
  const stats = dao.getProposalStats(proposalId);
  res.json(stats);
});

/**
 * DAO - 成员数量
 */
router.get('/dao/members/count', (req, res) => {
  const count = dao.getMemberCount();
  res.json({ memberCount: count });
});

module.exports = router;
