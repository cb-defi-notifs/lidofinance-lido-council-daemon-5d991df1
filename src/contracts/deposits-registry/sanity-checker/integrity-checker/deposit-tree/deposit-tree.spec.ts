import { digest2Bytes32, fromHexString, toHexString } from '../../../crypto';
import { DepositTree } from './deposit-tree';
import {
  depositDataRootsFixture20k,
  depositDataRootsFixture10k,
  dataTransformFixtures,
} from './deposit-tree.fixture';

describe('DepositTree', () => {
  let depositTree: DepositTree;

  beforeEach(() => {
    depositTree = new DepositTree();
  });

  test('should initialize zero hashes correctly', () => {
    expect(depositTree.zeroHashes[0]).toEqual(DepositTree.ZERO_HASH);
    for (let i = 1; i < DepositTree.DEPOSIT_CONTRACT_TREE_DEPTH; i++) {
      expect(depositTree.zeroHashes[i]).not.toEqual(undefined);
    }
  });

  test('should correctly insert a node and update the tree', () => {
    const initialNodeCount = depositTree.nodeCount;
    const node = new Uint8Array(32).fill(1); // Example node hash
    depositTree.insertNode(node);
    expect(depositTree.nodeCount).toBe(initialNodeCount + 1);
  });

  test('should handle detailed node data correctly', () => {
    const originalTree = new DepositTree();
    const nodeData = {
      wc: '0x123456789abcdef0',
      pubkey: '0xabcdef1234567890',
      signature: '0x987654321fedcba0',
      amount: '0x0100000000000000',
    };
    originalTree.insertNode(DepositTree.formDepositNode(nodeData));
    expect(originalTree.nodeCount).toBe(1);

    const oldDepositRoot = originalTree.getRoot();
    const cloned = originalTree.clone();

    cloned.insertNode(
      DepositTree.formDepositNode({ ...nodeData, wc: '0x123456789abcdef1' }),
    );

    expect(cloned.getRoot()).not.toEqual(oldDepositRoot);
    expect(cloned.getRoot()).not.toEqual(originalTree.getRoot());
    expect(originalTree.getRoot()).toEqual(oldDepositRoot);

    const freshTree = new DepositTree();

    freshTree.insertNode(DepositTree.formDepositNode(nodeData));
    freshTree.insertNode(
      DepositTree.formDepositNode({ ...nodeData, wc: '0x123456789abcdef1' }),
    );

    expect(cloned.getRoot()).toEqual(freshTree.getRoot());
  });

  test('branches from cloned tree do not linked with original tree', () => {
    const originalTree = new DepositTree();
    const nodeData = {
      wc: '0x123456789abcdef0',
      pubkey: '0xabcdef1234567890',
      signature: '0x987654321fedcba0',
      amount: '0x0100000000000000',
    };

    originalTree.insertNode(
      DepositTree.formDepositNode({ ...nodeData, wc: '0x123456789abcdef1' }),
    );
    originalTree.insertNode(
      DepositTree.formDepositNode({ ...nodeData, wc: '0x123456789abcdef1' }),
    );

    originalTree.branch[0][0] = 1;
    const clone = originalTree.clone();
    originalTree.branch[0][1] = 1;

    expect(clone.branch[0][1]).toBe(142);
    expect(originalTree.branch[0][1]).toBe(1);
  });

  test('clone works correctly', () => {
    const nodeData = {
      wc: '0x123456789abcdef0',
      pubkey: '0xabcdef1234567890',
      signature: '0x987654321fedcba0',
      amount: '0x0100000000000000',
    };
    depositTree.insertNode(DepositTree.formDepositNode(nodeData));
    expect(depositTree.nodeCount).toBe(1);
  });

  test('should clone the tree correctly', () => {
    depositTree.insertNode(new Uint8Array(32).fill(1));
    const clonedTree = depositTree.clone();
    expect(clonedTree.nodeCount).toEqual(depositTree.nodeCount);
    expect(clonedTree.branch).toEqual(depositTree.branch);
    expect(clonedTree).not.toBe(depositTree);
  });

  test('branch updates correctly after multiple insertions', () => {
    const node1 = new Uint8Array(32).fill(1); // First example node
    depositTree.insertNode(node1); // First insertion

    expect(depositTree.branch[0]).toEqual(node1);

    const node2 = new Uint8Array(32).fill(2); // Second example node
    depositTree.insertNode(node2); // Second insertion

    // Now, we need to check the second level of the branch
    // This should use the same hashing function as used in your actual code
    const expectedHashAfterSecondInsert = digest2Bytes32(
      depositTree.branch[0],
      node2,
    );
    expect(depositTree.branch[1]).toEqual(expectedHashAfterSecondInsert);
  });

  test('should throw error on invalid NodeData', () => {
    const invalidNodeData = {
      wc: 'xyz',
      pubkey: 'abc',
      signature: '123',
      amount: 'not a number',
    };
    expect(() => DepositTree.formDepositNode(invalidNodeData)).toThrowError();
  });

  test.each(dataTransformFixtures)(
    'actual validation using data and hash from blockchain',
    (event) => {
      const depositDataRoot = DepositTree.formDepositNode({
        wc: event.wc,
        pubkey: event.pubkey,
        signature: event.signature,
        amount: event.amount,
      });

      expect(toHexString(depositDataRoot)).toEqual(event.depositDataRoot);
    },
  );

  test('hashes should matches with fixtures (first 10k blocks from holesky)', () => {
    depositDataRootsFixture10k.events.map((ev) =>
      depositTree.insertNode(fromHexString(ev)),
    );

    expect(depositTree.nodeCount).toEqual(
      depositDataRootsFixture10k.events.length,
    );
    expect(depositTree.getRoot()).toEqual(depositDataRootsFixture10k.root);
  });

  test('hashes should matches with fixtures (second 10k blocks from holesky)', () => {
    depositDataRootsFixture10k.events.map((ev) =>
      depositTree.insertNode(fromHexString(ev)),
    );

    expect(depositTree.nodeCount).toEqual(
      depositDataRootsFixture10k.events.length,
    );
    expect(depositTree.getRoot()).toEqual(depositDataRootsFixture10k.root);

    depositDataRootsFixture20k.events.map((ev) =>
      depositTree.insertNode(fromHexString(ev)),
    );
    expect(depositTree.nodeCount).toEqual(
      depositDataRootsFixture10k.events.length +
        depositDataRootsFixture20k.events.length,
    );
    expect(depositTree.getRoot()).toEqual(depositDataRootsFixture20k.root);
  });
});
