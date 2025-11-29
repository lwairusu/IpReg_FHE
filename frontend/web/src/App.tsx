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
    category: "法律"
  });
  const [selectedRecord, setSelectedRecord] = useState<IPRecord | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [userHistory, setUserHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [stats, setStats] = useState({
    totalRecords: 0,
    verifiedRecords: 0,
    userRecords: 0,
    avgValue: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [contractAddress, setContractAddress] = useState("");

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
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
      updateStats(recordsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (recordsList: IPRecord[]) => {
    const totalRecords = recordsList.length;
    const verifiedRecords = recordsList.filter(r => r.isVerified).length;
    const userRecords = address ? recordsList.filter(r => r.creator.toLowerCase() === address.toLowerCase()).length : 0;
    const avgValue = recordsList.length > 0 ? recordsList.reduce((sum, r) => sum + r.publicValue1, 0) / recordsList.length : 0;
    
    setStats({ totalRecords, verifiedRecords, userRecords, avgValue });
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
      
      const encryptedResult = await encrypt(contractAddress, address, ipValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRecordData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        ipValue,
        0,
        newRecordData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      addUserHistory('create', businessId, newRecordData.name);
      
      setTransactionStatus({ visible: true, status: "success", message: "IP记录创建成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewRecordData({ name: "", ipValue: "", description: "", category: "法律" });
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
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "数据已在链上验证" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        addUserHistory('verify', businessId, businessData.name);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "在链上验证解密..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      addUserHistory('verify', businessId, businessData.name);
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "数据已在链上验证" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "解密失败: " + (e.message || "未知错误") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const addUserHistory = (action: string, recordId: string, recordName: string) => {
    const historyItem = {
      action,
      recordId,
      recordName,
      timestamp: Date.now(),
      address
    };
    setUserHistory(prev => [historyItem, ...prev.slice(0, 9)]);
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "合约可用性检查成功!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "可用性检查失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredRecords = records.filter(record => {
    const matchesSearch = record.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         record.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "all" || record.description.includes(filterCategory);
    return matchesSearch && matchesCategory;
  });

  const renderStats = () => (
    <div className="stats-grid">
      <div className="stat-card gold">
        <div className="stat-icon">📊</div>
        <div className="stat-content">
          <div className="stat-value">{stats.totalRecords}</div>
          <div className="stat-label">总记录数</div>
        </div>
      </div>
      <div className="stat-card silver">
        <div className="stat-icon">✅</div>
        <div className="stat-content">
          <div className="stat-value">{stats.verifiedRecords}</div>
          <div className="stat-label">已验证记录</div>
        </div>
      </div>
      <div className="stat-card bronze">
        <div className="stat-icon">👤</div>
        <div className="stat-content">
          <div className="stat-value">{stats.userRecords}</div>
          <div className="stat-label">我的记录</div>
        </div>
      </div>
      <div className="stat-card copper">
        <div className="stat-icon">⚡</div>
        <div className="stat-content">
          <div className="stat-value">{stats.avgValue.toFixed(1)}</div>
          <div className="stat-label">平均价值</div>
        </div>
      </div>
    </div>
  );

  const renderFHEProcess = () => (
    <div className="fhe-process">
      <div className="process-step">
        <div className="step-number">1</div>
        <div className="step-content">
          <h4>数据加密</h4>
          <p>使用Zama FHE加密IP哈希值</p>
        </div>
      </div>
      <div className="process-arrow">→</div>
      <div className="process-step">
        <div className="step-number">2</div>
        <div className="step-content">
          <h4>链上存储</h4>
          <p>加密数据存储在区块链上</p>
        </div>
      </div>
      <div className="process-arrow">→</div>
      <div className="process-step">
        <div className="step-number">3</div>
        <div className="step-content">
          <h4>离线解密</h4>
          <p>客户端使用relayer-sdk解密</p>
        </div>
      </div>
      <div className="process-arrow">→</div>
      <div className="process-step">
        <div className="step-number">4</div>
        <div className="step-content">
          <h4>链上验证</h4>
          <p>通过FHE.checkSignatures验证</p>
        </div>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header metal">
          <div className="logo-section">
            <h1>IP隱私註冊局 🔐</h1>
            <p>基于FHE的全同态加密知识产权保护</p>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content">
            <div className="prompt-icon">🔒</div>
            <h2>连接钱包开始使用</h2>
            <p>连接您的钱包来初始化FHE加密系统，保护您的知识产权</p>
            <div className="feature-grid">
              <div className="feature-card">
                <div className="feature-icon">⚡</div>
                <h4>即时加密</h4>
                <p>使用Zama FHE技术保护数据隐私</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🔍</div>
                <h4>可验证</h4>
                <p>在不暴露细节的情况下证明所有权</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🌐</div>
                <h4>去中心化</h4>
                <p>基于区块链的永久存证</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="metal-spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p className="loading-note">这可能需要一些时间</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>加载IP注册系统...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header metal">
        <div className="header-main">
          <div className="logo-section">
            <h1>IP隱私註冊局 🔐</h1>
            <p>全同态加密知识产权保护平台</p>
          </div>
          
          <div className="header-actions">
            <button 
              onClick={() => setShowHistory(true)}
              className="history-btn metal-btn"
            >
              操作历史
            </button>
            <button 
              onClick={checkAvailability}
              className="check-btn metal-btn"
            >
              检查合约
            </button>
            <button 
              onClick={() => setShowCreateModal(true)} 
              className="create-btn metal-btn primary"
            >
              + 注册IP
            </button>
            <ConnectButton />
          </div>
        </div>
        
        <nav className="app-nav">
          <button className="nav-item active">仪表板</button>
          <button className="nav-item">我的记录</button>
          <button className="nav-item">验证服务</button>
          <button className="nav-item">帮助文档</button>
        </nav>
      </header>
      
      <main className="main-content">
        <section className="dashboard-section">
          <div className="section-header">
            <h2>IP注册统计</h2>
            <button 
              onClick={loadData} 
              className="refresh-btn metal-btn"
              disabled={isRefreshing}
            >
              {isRefreshing ? "刷新中..." : "刷新数据"}
            </button>
          </div>
          {renderStats()}
          
          <div className="info-panel metal-panel">
            <h3>FHE加密流程</h3>
            {renderFHEProcess()}
          </div>
        </section>
        
        <section className="records-section">
          <div className="section-header">
            <h2>IP注册记录</h2>
            <div className="filters">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="搜索IP记录..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
              </div>
              <select 
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="filter-select"
              >
                <option value="all">所有分类</option>
                <option value="法律">法律</option>
                <option value="技术">技术</option>
                <option value="创意">创意</option>
              </select>
            </div>
          </div>
          
          <div className="records-grid">
            {filteredRecords.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📝</div>
                <p>暂无IP记录</p>
                <button 
                  className="create-btn metal-btn primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  注册第一个IP
                </button>
              </div>
            ) : (
              filteredRecords.map((record, index) => (
                <div 
                  key={record.id}
                  className={`record-card ${record.isVerified ? 'verified' : ''} metal-card`}
                  onClick={() => setSelectedRecord(record)}
                >
                  <div className="card-header">
                    <h3>{record.name}</h3>
                    <span className={`status-badge ${record.isVerified ? 'verified' : 'pending'}`}>
                      {record.isVerified ? '✅ 已验证' : '⏳ 待验证'}
                    </span>
                  </div>
                  <div className="card-content">
                    <p>{record.description}</p>
                    <div className="card-meta">
                      <span>价值: {record.publicValue1}</span>
                      <span>{new Date(record.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="card-footer">
                    <span>创建者: {record.creator.substring(0, 6)}...{record.creator.substring(38)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
      
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
          decryptData={() => decryptData(selectedRecord.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {showHistory && (
        <HistoryModal 
          history={userHistory}
          onClose={() => setShowHistory(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="metal-spinner small"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
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
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
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
      <div className="create-modal metal-modal">
        <div className="modal-header">
          <h2>注册新IP</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice metal-notice">
            <strong>FHE全同态加密保护</strong>
            <p>IP哈希值将使用Zama FHE进行加密（仅支持整型数字）</p>
          </div>
          
          <div className="form-group">
            <label>IP名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={recordData.name} 
              onChange={handleChange} 
              placeholder="输入IP名称..." 
              className="metal-input"
            />
          </div>
          
          <div className="form-group">
            <label>IP哈希值（整数） *</label>
            <input 
              type="number" 
              name="ipValue" 
              value={recordData.ipValue} 
              onChange={handleChange} 
              placeholder="输入IP哈希值..." 
              step="1"
              min="0"
              className="metal-input"
            />
            <div className="input-hint">FHE加密整型数据</div>
          </div>
          
          <div className="form-group">
            <label>分类 *</label>
            <select 
              name="category" 
              value={recordData.category} 
              onChange={handleChange}
              className="metal-select"
            >
              <option value="法律">法律</option>
              <option value="技术">技术</option>
              <option value="创意">创意</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>描述</label>
            <textarea 
              name="description" 
              value={recordData.description} 
              onChange={handleChange} 
              placeholder="输入IP描述..." 
              className="metal-textarea"
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !recordData.name || !recordData.ipValue} 
            className="submit-btn metal-btn primary"
          >
            {creating || isEncrypting ? "加密并注册中..." : "注册IP"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RecordDetailModal: React.FC<{
  record: IPRecord;
  onClose: () => void;
  decryptData: () => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ record, onClose, decryptData, isDecrypting }) => {
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const value = await decryptData();
    setDecryptedValue(value);
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal metal-modal">
        <div className="modal-header">
          <h2>IP记录详情</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="record-info">
            <div className="info-row">
              <span>IP名称:</span>
              <strong>{record.name}</strong>
            </div>
            <div className="info-row">
              <span>创建者:</span>
              <strong>{record.creator.substring(0, 6)}...{record.creator.substring(38)}</strong>
            </div>
            <div className="info-row">
              <span>创建时间:</span>
              <strong>{new Date(record.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-row">
              <span>描述:</span>
              <p>{record.description}</p>
            </div>
          </div>
          
          <div className="data-section">
            <h3>加密数据</h3>
            <div className="encryption-status">
              <div className="status-item">
                <span>验证状态:</span>
                <span className={`status ${record.isVerified ? 'verified' : 'pending'}`}>
                  {record.isVerified ? '✅ 链上已验证' : '⏳ 待验证'}
                </span>
              </div>
              <div className="status-item">
                <span>哈希值:</span>
                <span>
                  {record.isVerified ? 
                    `${record.decryptedValue} (已解密)` : 
                    decryptedValue !== null ? 
                    `${decryptedValue} (本地解密)` : 
                    "🔒 FHE加密中"
                  }
                </span>
              </div>
            </div>
            
            <div className="fhe-explanation metal-notice">
              <div className="explanation-icon">🔐</div>
              <div>
                <strong>FHE全同态加密</strong>
                <p>数据在链上加密存储。点击验证按钮进行离线解密和链上验证。</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">关闭</button>
          {!record.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn metal-btn primary"
            >
              {isDecrypting ? "验证中..." : "验证解密"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const HistoryModal: React.FC<{
  history: any[];
  onClose: () => void;
}> = ({ history, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="history-modal metal-modal">
        <div className="modal-header">
          <h2>操作历史</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          {history.length === 0 ? (
            <div className="empty-history">
              <div className="empty-icon">📋</div>
              <p>暂无操作记录</p>
            </div>
          ) : (
            <div className="history-list">
              {history.map((item, index) => (
                <div key={index} className="history-item">
                  <div className="history-action">
                    {item.action === 'create' ? '📝 创建' : '🔍 验证'}
                  </div>
                  <div className="history-details">
                    <strong>{item.recordName}</strong>
                    <span>{new Date(item.timestamp).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;