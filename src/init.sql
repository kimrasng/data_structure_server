USE DataStructure;

CREATE TABLE devices(
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT "고유 ID",
    device_name VARCHAR(255) NOT NULL COMMENT "디바이스 이름",
    location VARCHAR(255) NOT NULL COMMENT "설치 장소",
    url VARCHAR(255) UNIQUE NOT NULL COMMENT "고유 URL",
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT "생성 시간",
    UNIQUE KEY (id)
);

CREATE TABLE threshold(
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT "고유 ID",
    safe INT NOT NULL DEFAULT 30 COMMENT "여유",
    normal INT NOT NULL DEFAULT 50 COMMENT "보통",
    warning INT NOT NULL DEFAULT 80 COMMENT "주의",
    danger INT NOT NULL DEFAULT 120 COMMENT "위험",
    foreign key (id) references devices(id)
);

CREATE TABLE crowd_data(
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    headcount INT NOT NULL COMMENT "사람수",
    status ENUM('safe', 'normal', 'warning', 'danger') NOT NULL,
    foreign key (device_id) references devices(id)
);