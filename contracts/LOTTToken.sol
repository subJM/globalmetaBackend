// SPDX-License-Identifier: MIT
pragma solidity ^0.5.8;

/*
 LOTT (TRC20, TRON / Solidity 0.5.8)
 - name/symbol: LOTT / LOTT
 - decimals: 18
 - initial supply: 5,000,000,000 * 10^18 to deployer
 - Ownable 2-step
 - Pausable (global pause)
 - Blacklist
 - MINTER role (owner can add/remove multiple minters)
 - Burn / BurnFrom
 - Emergency-Recovery (timelocked forced transfer; requires from-address blacklisted)
 - Account Lock (per-address timelock for transfers)
 - ReentrancyGuard
 - Logo metadata (struct) + legacy logoURI (항상 동기화)
 - rescueTRC20 (컨트랙트 보유 외부 토큰 회수; 반환값 호환)
 - rescueTRX + payable fallback (컨트랙트 보유 TRX 회수)
*/

library SafeMath {
    function add(uint256 a, uint256 b) internal pure returns (uint256) { uint256 c = a + b; require(c >= a, "add overflow"); return c; }
    function sub(uint256 a, uint256 b) internal pure returns (uint256) { require(b <= a, "sub underflow"); return a - b; }
}

contract ReentrancyGuard {
    bool private _notEntered;
    constructor() internal { _notEntered = true; }
    modifier nonReentrant() {
        require(_notEntered, "reentrant");
        _notEntered = false;
        _;
        _notEntered = true;
    }
}

contract Ownable2Step {
    address public owner;
    address public pendingOwner;
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    constructor() internal { owner = msg.sender; }
    modifier onlyOwner() { require(msg.sender == owner, "only owner"); _; }
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero addr");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pendingOwner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }
}

contract Pausable is Ownable2Step {
    bool public paused;
    event Paused(address account);
    event Unpaused(address account);
    modifier whenNotPaused() { require(!paused, "paused"); _; }
    modifier whenPaused() { require(paused, "not paused"); _; }
    function pause() external onlyOwner whenNotPaused { paused = true; emit Paused(msg.sender); }
    function unpause() external onlyOwner whenPaused { paused = false; emit Unpaused(msg.sender); }
}

contract TRC20Core is Pausable, ReentrancyGuard {
    using SafeMath for uint256;

    string public name = "LOTT";
    string public symbol = "LOTT";
    uint8  public decimals = 18;

    uint256 private _totalSupply;
    mapping(address => uint256) internal _balances;
    mapping(address => mapping(address => uint256)) internal _allowances;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function totalSupply() public view returns (uint256) { return _totalSupply; }
    function balanceOf(address who) public view returns (uint256) { return _balances[who]; }
    function allowance(address owner_, address spender) public view returns (uint256) { return _allowances[owner_][spender]; }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "to zero");
        _balances[from] = _balances[from].sub(value);
        _balances[to]   = _balances[to].add(value);
        emit Transfer(from, to, value);
    }

    function transfer(address to, uint256 value) public whenNotPaused returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) public whenNotPaused returns (bool) {
        _allowances[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public whenNotPaused returns (bool) {
        uint256 a = _allowances[from][msg.sender];
        require(a >= value, "allowance");
        _allowances[from][msg.sender] = a - value;
        _transfer(from, to, value);
        return true;
    }

    function _mint(address to, uint256 amountWei) internal {
        require(to != address(0), "mint to zero");
        _totalSupply = _totalSupply.add(amountWei);
        _balances[to] = _balances[to].add(amountWei);
        emit Transfer(address(0), to, amountWei);
    }

    function _burn(address from, uint256 amountWei) internal {
        _balances[from] = _balances[from].sub(amountWei);
        _totalSupply = _totalSupply.sub(amountWei);
        emit Transfer(from, address(0), amountWei);
    }
}

contract LOTTToken is TRC20Core {
    using SafeMath for uint256;

    // --- Logo metadata (new) + legacy field (synced) ---
    struct Logo {
        string   uri;           // ex) https://.../lott.jpg (또는 ipfs://...)
        bytes32  sha256Hash;    // 원본 이미지의 SHA-256 (선택)
        uint256  version;       // 업데이트마다 +1
        uint256  lastUpdated;   // unix timestamp
        bool     locked;        // true면 더 이상 변경 불가
    }
    Logo public logo;
    string public logoURI; // legacy 호환 (항상 logo.uri와 동기화)

    event LogoUpdated(string uri, bytes32 sha256Hash, uint256 version);
    event LogoLocked();
    event LogoURISet(string uri);

    // --- roles (simple mapping) ---
    mapping(address => bool) public minters;
    event MinterAdded(address indexed account);
    event MinterRemoved(address indexed account);
    modifier onlyMinter() { require(minters[msg.sender], "only minter"); _; }

    // --- blacklist ---
    mapping(address => bool) public blacklisted;
    event Blacklisted(address indexed account, bool isBlacklisted);

    // --- account-level lock (timelock per address) ---
    mapping(address => uint256) public lockUntil; // unix timestamp
    event AccountLocked(address indexed account, uint256 until);
    event AccountUnlocked(address indexed account);

    // --- emergency recovery (timelocked forced transfer) ---
    struct Recovery {
        address proposer;
        address from;
        address to;
        uint256 amount;
        uint256 executeAfter;
        bool executed;
        bool cancelled;
    }
    uint256 public recoveryCount = 0;
    mapping(uint256 => Recovery) public recoveries;
    uint256 public recoveryDelay; // e.g., 48h
    event RecoveryProposed(uint256 indexed id, address indexed proposer, address indexed from, address to, uint256 amount, uint256 executeAfter);
    event RecoveryExecuted(uint256 indexed id, address indexed executor);
    event RecoveryCancelled(uint256 indexed id, address indexed canceller);

    // --- rescue events (TRC20/TRX) ---
    event RescueTRC20(address indexed token, address indexed to, uint256 amount);
    event RescueTRX(address indexed to, uint256 amountSun);

    // initial supply: 5,000,000,000 * 10^18
    uint256 private constant INITIAL_UNITS = 5000000000;
    uint256 private constant DECIMALS_ = 18;

    // ===== Constructor =====
    constructor(string memory _logoURI, uint256 _recoveryDelaySeconds) public {
        // logo init + legacy sync
        logo.uri = _logoURI;
        logo.sha256Hash = 0x0;     // 원하면 실제 SHA-256 넣기
        logo.version = 1;
        logo.lastUpdated = now;
        logo.locked = false;
        emit LogoUpdated(_logoURI, 0x0, 1);

        logoURI = _logoURI;
        emit LogoURISet(_logoURI);

        // recovery delay
        recoveryDelay = _recoveryDelaySeconds;

        // initial mint to deployer
        uint256 init = INITIAL_UNITS * (10 ** uint256(DECIMALS_));
        _mint(msg.sender, init);

        // initial minter
        minters[msg.sender] = true;
        emit MinterAdded(msg.sender);
    }

    // ===== Logo setters/getters =====
    function setLogo(string memory uri, bytes32 sha256Hash) public onlyOwner {
        require(!logo.locked, "logo locked");
        require(bytes(uri).length > 0, "empty uri");
        Logo storage L = logo;
        L.uri = uri;
        L.sha256Hash = sha256Hash;
        L.version = L.version + 1;
        L.lastUpdated = now;
        emit LogoUpdated(uri, sha256Hash, L.version);
        logoURI = uri;
        emit LogoURISet(uri);
    }

    // 레거시 엔드포인트: 내부적으로 setLogo로 위임
    function setLogoURI(string calldata uri) external onlyOwner {
        setLogo(uri, 0x0);
    }

    function lockLogo() external onlyOwner {
        require(!logo.locked, "already locked");
        logo.locked = true;
        emit LogoLocked();
    }

    function getLogo()
        external
        view
        returns (string memory uri, bytes32 hash_, uint256 version, uint256 updated, bool locked)
    {
        return (logo.uri, logo.sha256Hash, logo.version, logo.lastUpdated, logo.locked);
    }

    // ===== Admin: recovery delay =====
    function setRecoveryDelay(uint256 secondsDelay) external onlyOwner {
        require(secondsDelay <= 30 days, "too long");
        recoveryDelay = secondsDelay;
    }

    // ===== Blacklist =====
    function setBlacklist(address a, bool v) external onlyOwner {
        blacklisted[a] = v;
        emit Blacklisted(a, v);
    }

    // ===== Account Lock (per-address timelock) =====
    function setLock(address a, uint256 untilUnix) external onlyOwner {
        require(a != address(0), "zero");
        lockUntil[a] = untilUnix;
        emit AccountLocked(a, untilUnix);
    }
    function clearLock(address a) external onlyOwner {
        lockUntil[a] = 0;
        emit AccountUnlocked(a);
    }
    function _checkLock(address a) internal view {
        require(now >= lockUntil[a], "account locked");
    }

    // blacklist + lock + pause 체크 포함 전송
    function transfer(address to, uint256 value) public whenNotPaused returns (bool) {
        require(!blacklisted[msg.sender] && !blacklisted[to], "blacklisted");
        _checkLock(msg.sender);
        return super.transfer(to, value);
    }
    function transferFrom(address from, address to, uint256 value) public whenNotPaused returns (bool) {
        require(!blacklisted[from] && !blacklisted[to], "blacklisted");
        _checkLock(from);
        return super.transferFrom(from, to, value);
    }

    // ===== Mint / Burn =====
    function addMinter(address account) external onlyOwner {
        require(account != address(0), "zero");
        minters[account] = true;
        emit MinterAdded(account);
    }
    function removeMinter(address account) external onlyOwner {
        minters[account] = false;
        emit MinterRemoved(account);
    }

    // amountWei는 10^18 단위(wei-like)
    function mint(address to, uint256 amountWei) external onlyMinter returns (bool) {
        require(amountWei > 0, "zero amount");
        _mint(to, amountWei);
        return true;
    }

    function burn(uint256 amountWei) external returns (bool) {
        _burn(msg.sender, amountWei);
        return true;
    }
    function burnFrom(address account, uint256 amountWei) external returns (bool) {
        uint256 a = allowance(account, msg.sender); require(a >= amountWei, "allowance");
        _allowances[account][msg.sender] = a - amountWei;
        emit Approval(account, msg.sender, a - amountWei); // ← 추가    
        _burn(account, amountWei);
        return true;
    }

    // ===== Emergency Recovery (proposal → timelock → execute) =====
    function proposeRecovery(address from, address to, uint256 amountWei) external onlyOwner returns (uint256) {
        require(from != address(0) && to != address(0) && from != to, "bad addr");
        require(amountWei > 0, "zero amount");
        uint256 id = ++recoveryCount;
        recoveries[id] = Recovery({
            proposer: msg.sender,
            from: from,
            to: to,
            amount: amountWei,
            executeAfter: now + recoveryDelay,
            executed: false,
            cancelled: false
        });
        emit RecoveryProposed(id, msg.sender, from, to, amountWei, recoveries[id].executeAfter);
        return id;
    }

    function cancelRecovery(uint256 id) external onlyOwner {
        Recovery storage r = recoveries[id];
        require(!r.executed && !r.cancelled, "done");
        r.cancelled = true;
        emit RecoveryCancelled(id, msg.sender);
    }

    function executeRecovery(uint256 id) external onlyOwner nonReentrant {
        Recovery storage r = recoveries[id];
        require(!r.executed && !r.cancelled, "done");
        require(r.executeAfter > 0 && now >= r.executeAfter, "too early");
        require(blacklisted[r.from], "from must be blacklisted"); // safety
        require(_balances[r.from] >= r.amount, "insufficient");
        _balances[r.from] = _balances[r.from].sub(r.amount);
        _balances[r.to]   = _balances[r.to].add(r.amount);
        r.executed = true;
        emit Transfer(r.from, r.to, r.amount);
        emit RecoveryExecuted(id, msg.sender);
    }

    // ===== Rescue: TRC20 (컨트랙트가 보유한 외부 토큰) =====
    function rescueTRC20(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "to zero");
        require(token != address(this), "no self rescue");

        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, amount)
        );
        require(ok, "low-level call failed");
        // 일부 토큰은 bool 반환, 일부는 반환값 없음 → 모두 호환
        if (data.length > 0) {
            require(abi.decode(data, (bool)), "transfer returned false");
        }
        emit RescueTRC20(token, to, amount);
    }

    // ===== Rescue: TRX (컨트랙트가 보유한 네이티브 TRX) =====

    // Solidity 0.5.x fallback (TRX 수신 허용)
    function() external payable { }

    // 컨트랙트 잔고에서 TRX 회수
    function rescueTRX(address payable to, uint256 amountSun) external onlyOwner nonReentrant {
        require(to != address(0), "to zero");
        require(address(this).balance >= amountSun, "insufficient TRX");
        (bool sent, ) = to.call.value(amountSun)("");
        require(sent, "send TRX failed");
        emit RescueTRX(to, amountSun);
    }
    
    function increaseAllowance(address spender, uint256 added) external whenNotPaused returns (bool) {
        uint256 next = _allowances[msg.sender][spender].add(added);
        _allowances[msg.sender][spender] = next;
        emit Approval(msg.sender, spender, next);
    return true;
    }
    function decreaseAllowance(address spender, uint256 subd) external whenNotPaused returns (bool) {
        uint256 next = _allowances[msg.sender][spender].sub(subd);
        _allowances[msg.sender][spender] = next;
        emit Approval(msg.sender, spender, next);
        return true;
    }

}
