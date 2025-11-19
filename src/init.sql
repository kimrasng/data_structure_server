USE DataStructure;

CREATE TABLE devices(
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT "고유 ID",
    device_name VARCHAR(255) NOT NULL COMMENT "디바이스 이름",
    location VARCHAR(255) NOT NULL COMMENT "설치 장소",
    url VARCHAR(255) UNIQUE NOT NULL COMMENT "고유 URL",
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT "생성 시간",
    UNIQUE KEY (id)
);

CREATE TABLE crowd_data(
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    headcount INT NOT NULL COMMENT "사람수",
    status ENUM('safe', 'normal', 'warning', 'danger') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT "측정 시각",
    FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE device_neighbors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL COMMENT '기준 디바이스',
    neighbor_device_id INT NOT NULL COMMENT '인접 디바이스',
    FOREIGN KEY (device_id) REFERENCES devices(id),
    FOREIGN KEY (neighbor_device_id) REFERENCES devices(id),
    UNIQUE KEY uniq_neighbor (device_id, neighbor_device_id)
);

CREATE TABLE tracked_devices (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    mac_hash VARBINARY(32) NOT NULL COMMENT 'MAC ADDRESS',
    first_seen DATETIME NOT NULL,
    last_seen DATETIME NOT NULL,
    UNIQUE KEY uniq_mac_hash (mac_hash)
);

CREATE TABLE device_observations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tracked_device_id BIGINT NOT NULL,
    device_id INT NOT NULL,
    observed_at DATETIME NOT NULL,
    rssi TINYINT NULL,
    FOREIGN KEY (tracked_device_id) REFERENCES tracked_devices(id),
    FOREIGN KEY (device_id) REFERENCES devices(id),
    INDEX idx_device_time (device_id, observed_at),
    INDEX idx_tracked_time (tracked_device_id, observed_at)
);