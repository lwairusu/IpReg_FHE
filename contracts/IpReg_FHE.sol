pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract IpReg_FHE is ZamaEthereumConfig {
    
    struct IpRecord {
        string ipHash;                    
        euint32 encryptedMetadata;        
        uint256 registrationDate;         
        uint256 expirationDate;          
        string jurisdiction;              
        address owner;                   
        uint256 timestamp;                
        uint32 decryptedMetadata;        
        bool isVerified;                 
    }
    
    mapping(string => IpRecord) public ipRecords;
    string[] public ipHashes;
    
    event IpRecordCreated(string indexed ipHash, address indexed owner);
    event DecryptionVerified(string indexed ipHash, uint32 decryptedMetadata);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createIpRecord(
        string calldata ipHash,
        externalEuint32 encryptedMetadata,
        bytes calldata inputProof,
        uint256 registrationDate,
        uint256 expirationDate,
        string calldata jurisdiction
    ) external {
        require(bytes(ipRecords[ipHash].ipHash).length == 0, "IP record already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedMetadata, inputProof)), "Invalid encrypted input");
        
        ipRecords[ipHash] = IpRecord({
            ipHash: ipHash,
            encryptedMetadata: FHE.fromExternal(encryptedMetadata, inputProof),
            registrationDate: registrationDate,
            expirationDate: expirationDate,
            jurisdiction: jurisdiction,
            owner: msg.sender,
            timestamp: block.timestamp,
            decryptedMetadata: 0,
            isVerified: false
        });
        
        FHE.allowThis(ipRecords[ipHash].encryptedMetadata);
        FHE.makePubliclyDecryptable(ipRecords[ipHash].encryptedMetadata);
        
        ipHashes.push(ipHash);
        emit IpRecordCreated(ipHash, msg.sender);
    }
    
    function verifyDecryption(
        string calldata ipHash, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(ipRecords[ipHash].ipHash).length > 0, "IP record does not exist");
        require(!ipRecords[ipHash].isVerified, "Data already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(ipRecords[ipHash].encryptedMetadata);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        ipRecords[ipHash].decryptedMetadata = decodedValue;
        ipRecords[ipHash].isVerified = true;
        
        emit DecryptionVerified(ipHash, decodedValue);
    }
    
    function getEncryptedMetadata(string calldata ipHash) external view returns (euint32) {
        require(bytes(ipRecords[ipHash].ipHash).length > 0, "IP record does not exist");
        return ipRecords[ipHash].encryptedMetadata;
    }
    
    function getIpRecord(string calldata ipHash) external view returns (
        string memory ipHashValue,
        uint256 registrationDate,
        uint256 expirationDate,
        string memory jurisdiction,
        address owner,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedMetadata
    ) {
        require(bytes(ipRecords[ipHash].ipHash).length > 0, "IP record does not exist");
        IpRecord storage record = ipRecords[ipHash];
        
        return (
            record.ipHash,
            record.registrationDate,
            record.expirationDate,
            record.jurisdiction,
            record.owner,
            record.timestamp,
            record.isVerified,
            record.decryptedMetadata
        );
    }
    
    function getAllIpHashes() external view returns (string[] memory) {
        return ipHashes;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}

