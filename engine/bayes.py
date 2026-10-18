"""
v2 베이지안 업데이트 + v3 Thompson Sampling (docs/DESIGN.md 4.5, 4.6)

모형:  y_T = β₀ + βᵀ φ(T) + ε,   ε ~ N(0, σ²)
사전:  σ² ~ IG(a₀, b₀),  (β₀, β) | σ² ~ N(μ₀, σ² Λ₀⁻¹)   (Normal–Inverse-Gamma, 켤레)
       μ₀ = (3, 2w)  — 운영자 가중치 w를 1~5점 척도로 옮긴 값
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class NIG:
    mu: np.ndarray        # (d,)
    Lam: np.ndarray       # (d, d) 정밀도 행렬 (σ² 단위)
    a: float
    b: float

    # ------------------------------------------------------------ 생성
    @classmethod
    def prior(cls, weights: list[float], strength: float = 2.0, a0: float = 2.0, b0: float = 0.25) -> "NIG":
        """
        strength: 사전분포의 강도. 대략 '운영자 경험을 테이블 몇 개 분량의 데이터로 볼지'.
        a0=2, b0=0.25 → E[σ²] = b0/(a0-1) = 0.25 (만족도 표준편차 약 0.5점)
        """
        mu0 = np.concatenate([[3.0], 2.0 * np.asarray(weights, dtype=float)])
        return cls(mu=mu0, Lam=strength * np.eye(len(mu0)), a=a0, b=b0)

    # ------------------------------------------------------------ 갱신 (닫힌 형태)
    def update(self, Phi: np.ndarray, y: np.ndarray) -> "NIG":
        """Phi: (N, 5) 테이블 특성, y: (N,) 테이블 만족도 평균."""
        if len(y) == 0:
            return self
        X = np.column_stack([np.ones(len(y)), Phi])
        Lam_n = self.Lam + X.T @ X
        mu_n = np.linalg.solve(Lam_n, self.Lam @ self.mu + X.T @ y)
        a_n = self.a + len(y) / 2
        b_n = self.b + 0.5 * (y @ y + self.mu @ self.Lam @ self.mu - mu_n @ Lam_n @ mu_n)
        return NIG(mu=mu_n, Lam=Lam_n, a=a_n, b=float(max(b_n, 1e-9)))

    # ------------------------------------------------------------ 사용
    @property
    def sigma2_mean(self) -> float:
        return self.b / (self.a - 1) if self.a > 1 else float("nan")

    def coef_sd(self) -> np.ndarray:
        """β의 주변 사후 표준편차 (Student-t 근사 대신 E[σ²] 대입)."""
        return np.sqrt(np.diag(np.linalg.inv(self.Lam)) * self.sigma2_mean)

    def sample(self, rng: np.random.Generator) -> np.ndarray:
        """Thompson Sampling: σ̃² ~ IG(a, b), β̃ ~ N(μ, σ̃² Λ⁻¹)."""
        sigma2 = self.b / rng.gamma(self.a)          # IG(a, b) 표본
        cov = sigma2 * np.linalg.inv(self.Lam)
        return rng.multivariate_normal(self.mu, cov)

    def predict(self, phi: list[float], beta: np.ndarray | None = None) -> float:
        b = self.mu if beta is None else beta
        return float(b[0] + np.dot(b[1:], phi))

    def to_json(self) -> dict:
        return {"mu": self.mu.tolist(), "Lam": self.Lam.tolist(), "a": self.a, "b": self.b}

    @classmethod
    def from_json(cls, d: dict) -> "NIG":
        return cls(mu=np.array(d["mu"]), Lam=np.array(d["Lam"]), a=d["a"], b=d["b"])
