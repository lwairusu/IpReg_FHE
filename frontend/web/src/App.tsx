import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface IPRecord {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<IPRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingRecord, setCreatingRecord] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newRecordData, setNewRecordData] = useState({ 
    name: "", 
    ipValue: "", 
    description: "",
    category: "" 
  });
  const [selectedRecord, setSelectedRecord] = useState<IPRecord | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [showFAQ, setShowFAQ] = useState(false);
  const [partners] = useState([
    "Zama Network",
    "FHE Foundation", 
    "IP Protection Alliance",
    "Crypto Legal Group"
  ]);
  const [faqs] = useState([
    { question: "什么是FHE加密？", answer: "全同态加密允许在加密数据上直接进行计算。" },
    { question: "如何验证版权？", answer: "通过解密验证时间戳和内容哈希。" },
    { question: "数据是否公开？", answer: "只有加密数据公开，原始内容始终保密。" }
  ]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (isConnected && !isInitialized) {
        try {
          await initialize();
        } catch (error) {
          console.error('FHEVM初始化失败:', error);
        }
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      try {
        await loadRecords();
      } catch (error) {
        console.error('加载数据失败:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [isConnected]);

  const loadRecords = async () => {
    if (!isConnected) return;
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const recordsList: IPRecord[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          recordsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      setRecords(recordsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "加载数据失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createRecord = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingRecord(true);
    setTransactionStatus({ visible: true, status: "pending", message: "使用Zama FHE创建IP记录..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const ipValue = parseInt(newRecordData.ipValue) || 0;
      const businessId = `ip-${Date.now()}`;
      const contractAddress = await contract.getAddress();
      
      const encryptedResult = await encrypt(contractAddress, address, ipValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRecordData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        newRecordData.category === "copyright" ? 1 : 0,
        0,
        newRecordData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "IP记录创建成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadRecords();
      setShowCreateModal(false);
      setNewRecordData({ name: "", ipValue: "", description: "", category: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingRecord(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        setTransactionStatus({ visible: true, status: "success", message: "数据已链上验证" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      const contractAddress = await contractRead.getAddress();
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "链上验证解密..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadRecords();
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "数据已链上验证" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadRecords();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "解密失败: " + (e.message || "未知错误") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "合约可用性检查成功!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "可用性检查失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredRecords = records.filter(record => {
    const matchesSearch = record.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         record.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "all" || 
                           (filterCategory === "copyright" && record.publicValue1 === 1) ||
                           (filterCategory === "patent" && record.publicValue1 === 0);
    return matchesSearch && matchesCategory;
  });

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>IP隐私注册局 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>连接钱包继续</h2>
            <p>请连接您的钱包来初始化加密IP注册系统</p>
            <div className="connection-steps">
              <div className="step"><span>1</span><p>点击上方按钮连接钱包</p></div>
              <div className="step"><span>2</span><p>FHE系统将自动初始化</p></div>
              <div className="step"><span>3</span><p>开始创建加密IP记录</p></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p>状态: {status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密IP系统...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>IP隐私注册局 🔐</h1>
          <p>全同态加密版权保护平台</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="check-btn">
            检查合约
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + 新IP记录
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <h3>总记录数</h3>
            <div className="stat-value">{records.length}</div>
          </div>
          <div className="stat-card">
            <h3>已验证记录</h3>
            <div className="stat-value">{records.filter(r => r.isVerified).length}</div>
          </div>
          <div className="stat-card">
            <h3>版权记录</h3>
            <div className="stat-value">{records.filter(r => r.publicValue1 === 1).length}</div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-bar">
            <input 
              type="text" 
              placeholder="搜索IP记录..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="all">所有类型</option>
              <option value="copyright">版权</option>
              <option value="patent">专利</option>
            </select>
            <button onClick={loadRecords} disabled={isRefreshing}>
              {isRefreshing ? "刷新中..." : "刷新"}
            </button>
          </div>
        </div>

        <div className="records-grid">
          {filteredRecords.map((record, index) => (
            <div key={index} className="record-card" onClick={() => setSelectedRecord(record)}>
              <div className="card-header">
                <h3>{record.name}</h3>
                <span className={`status ${record.isVerified ? 'verified' : 'pending'}`}>
                  {record.isVerified ? '✅ 已验证' : '🔓 待验证'}
                </span>
              </div>
              <p>{record.description}</p>
              <div className="card-meta">
                <span>类型: {record.publicValue1 === 1 ? '版权' : '专利'}</span>
                <span>时间: {new Date(record.timestamp * 1000).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="info-sections">
          <div className="partners-section">
            <h3>合作伙伴</h3>
            <div className="partners-grid">
              {partners.map((partner, index) => (
                <div key={index} className="partner-card">{partner}</div>
              ))}
            </div>
          </div>

          <div className="faq-section">
            <button onClick={() => setShowFAQ(!showFAQ)} className="faq-toggle">
              {showFAQ ? '隐藏' : '显示'}常见问题
            </button>
            {showFAQ && (
              <div className="faq-list">
                {faqs.map((faq, index) => (
                  <div key={index} className="faq-item">
                    <h4>{faq.question}</h4>
                    <p>{faq.answer}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <CreateRecordModal 
          onSubmit={createRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingRecord} 
          recordData={newRecordData} 
          setRecordData={setNewRecordData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedRecord && (
        <RecordDetailModal 
          record={selectedRecord} 
          onClose={() => setSelectedRecord(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptData={() => decryptData(selectedRecord.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateRecordModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, recordData, setRecordData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'ipValue') {
      const intValue = value.replace(/[^\d]/g, '');
      setRecordData({ ...recordData, [name]: intValue });
    } else {
      setRecordData({ ...recordData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-record-modal">
        <div className="modal-header">
          <h2>新建IP记录</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 加密保护</strong>
            <p>IP价值数据将使用Zama FHE进行加密（仅支持整数）</p>
          </div>
          
          <div className="form-group">
            <label>记录名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={recordData.name} 
              onChange={handleChange} 
              placeholder="输入记录名称..." 
            />
          </div>
          
          <div className="form-group">
            <label>IP价值（整数） *</label>
            <input 
              type="number" 
              name="ipValue" 
              value={recordData.ipValue} 
              onChange={handleChange} 
              placeholder="输入IP价值..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE加密整数</div>
          </div>
          
          <div className="form-group">
            <label>记录类型 *</label>
            <select name="category" value={recordData.category} onChange={handleChange}>
              <option value="">选择类型</option>
              <option value="copyright">版权</option>
              <option value="patent">专利</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>描述</label>
            <textarea 
              name="description" 
              value={recordData.description} 
              onChange={handleChange} 
              placeholder="输入记录描述..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !recordData.name || !recordData.ipValue || !recordData.category} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "加密并创建中..." : "创建记录"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RecordDetailModal: React.FC<{
  record: IPRecord;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ record, onClose, isDecrypting, decryptData }) => {
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (record.isVerified) {
      setDecryptedValue(record.decryptedValue);
      return;
    }
    const value = await decryptData();
    setDecryptedValue(value);
  };

  return (
    <div className="modal-overlay">
      <div className="record-detail-modal">
        <div className="modal-header">
          <h2>IP记录详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="record-info">
            <div className="info-item"><span>名称:</span><strong>{record.name}</strong></div>
            <div className="info-item"><span>创建者:</span><strong>{record.creator.substring(0, 6)}...{record.creator.substring(38)}</strong></div>
            <div className="info-item"><span>创建时间:</span><strong>{new Date(record.timestamp * 1000).toLocaleDateString()}</strong></div>
            <div className="info-item"><span>类型:</span><strong>{record.publicValue1 === 1 ? '版权' : '专利'}</strong></div>
            <div className="info-item"><span>描述:</span><strong>{record.description}</strong></div>
          </div>
          
          <div className="data-section">
            <h3>加密数据</h3>
            <div className="data-row">
              <div className="data-label">IP价值:</div>
              <div className="data-value">
                {record.isVerified ? 
                  `${record.decryptedValue} (链上已验证)` : 
                  decryptedValue !== null ? 
                  `${decryptedValue} (本地解密)` : 
                  "🔒 FHE加密整数"
                }
              </div>
              <button 
                className={`decrypt-btn ${(record.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "验证中..." : record.isVerified ? "✅ 已验证" : decryptedValue !== null ? "🔄 重新验证" : "🔓 验证解密"}
              </button>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
        </div>
      </div>
    </div>
  );
};

export default App;