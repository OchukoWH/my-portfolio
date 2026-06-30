---
title: "Terraform AWS Foundations"
description: "Notes on keeping AWS infrastructure modules small, reviewable, and safe to evolve."
date: "2026-06-20"
tags: "Terraform, AWS, Infrastructure"
published: true
---

Terraform works best when the structure of the code matches the structure of the platform. A good foundation is boring in the right ways: clear modules, explicit inputs, readable plans, and environments that can be changed without surprise.

## Useful module boundaries

I prefer modules that map to stable infrastructure concerns:

- Network foundations
- IAM roles and policies
- Compute and cluster primitives
- Observability and operational access
- Shared DNS and certificate resources

Modules should hide repeated wiring, not important decisions. If a reviewer cannot understand the impact of a plan, the abstraction is probably too clever.

## Reviewable plans

Small changes are easier to reason about. I try to keep Terraform workflows focused on readable diffs and predictable state boundaries:

```hcl
resource "aws_security_group_rule" "https_ingress" {
  type              = "ingress"
  security_group_id = aws_security_group.app.id
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = var.allowed_cidrs
}
```

The best infrastructure code makes the blast radius visible before apply.

## Where I am going deeper

My current focus is building reusable AWS patterns around Terraform, Kubernetes integration, IAM least privilege, and operational guardrails for platform teams.
