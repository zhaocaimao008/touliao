/**
 * P13.3: DAO 治理系统
 * 支持去中心化自治
 */
class DAOGovernance {
  constructor() {
    this.proposals = new Map();
    this.votes = new Map();
    this.members = new Map();
    this.tokenBalance = new Map();
  }

  /**
   * 创建提案
   */
  async createProposal(creator, title, description, options = []) {
    const proposalId = `prop_${Date.now()}`;
    
    const proposal = {
      id: proposalId,
      creator,
      title,
      description,
      options,
      votes: Object.fromEntries(options.map(o => [o, 0])),
      status: 'active',
      created: Date.now(),
      expires: Date.now() + 7 * 86400000, // 7 天
    };

    this.proposals.set(proposalId, proposal);
    return proposal;
  }

  /**
   * 投票
   */
  async vote(voter, proposalId, optionIndex) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error('提案不存在');
    if (proposal.status !== 'active') throw new Error('提案已结束');

    const votingPower = this.tokenBalance.get(voter) || 1;
    
    const voteKey = `${voter}:${proposalId}`;
    const existingVote = this.votes.get(voteKey);

    if (existingVote) {
      // 撤销之前的投票
      proposal.votes[existingVote.option] -= votingPower;
    }

    // 记录新投票
    proposal.votes[optionIndex] += votingPower;
    this.votes.set(voteKey, { option: optionIndex, power: votingPower });

    return { success: true, votingPower };
  }

  /**
   * 执行提案
   */
  async executeProposal(proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error('提案不存在');

    // 找出获胜选项
    const winner = Object.entries(proposal.votes).reduce((a, b) => 
      a[1] > b[1] ? a : b
    );

    proposal.status = 'executed';
    proposal.result = { winningSolution: winner[0], votes: winner[1] };

    return proposal;
  }

  /**
   * 获取提案统计
   */
  getProposalStats(proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return null;

    const totalVotes = Object.values(proposal.votes).reduce((a, b) => a + b, 0);
    
    return {
      proposalId,
      title: proposal.title,
      totalVotes,
      participation: totalVotes / this.members.size,
      results: proposal.votes,
      status: proposal.status,
    };
  }

  /**
   * 添加成员
   */
  addMember(address, tokenAmount = 1) {
    this.members.set(address, { joined: Date.now() });
    this.tokenBalance.set(address, tokenAmount);
  }

  getMemberCount() {
    return this.members.size;
  }
}

module.exports = DAOGovernance;
