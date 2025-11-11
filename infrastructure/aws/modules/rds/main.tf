resource "aws_db_subnet_group" "main" {
  name       = "education-platform-db-subnet-group"
  subnet_ids = var.subnet_ids

  tags = {
    Name = "Education Platform DB Subnet Group"
  }
}

resource "aws_security_group" "rds" {
  name        = "education-platform-rds-sg"
  description = "Security group for RDS"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "education-platform-rds-sg"
  }
}

resource "aws_db_instance" "main" {
  identifier             = "education-platform-db"
  engine                 = "postgres"
  engine_version         = "15.4"
  instance_class         = "db.t3.medium"
  allocated_storage      = 100
  max_allocated_storage  = 200
  storage_encrypted      = true
  db_name                = var.db_name
  username               = var.db_username
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  multi_az               = true
  backup_retention_period = 7
  skip_final_snapshot    = false
  final_snapshot_identifier = "education-platform-db-final-snapshot"

  tags = {
    Name = "education-platform-db"
  }
}

output "db_endpoint" {
  value = aws_db_instance.main.endpoint
}

